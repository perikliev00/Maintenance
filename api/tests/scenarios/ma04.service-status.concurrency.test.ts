/**
 * MA-04 — two staff marking the same room out of service record and notify one transition.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  PrismaClient,
  Role,
  ServiceStatus,
} from "@prisma/client";
import { assertTestDatabase } from "../assertTestDatabase";
import { withDatabaseBarrier } from "../dbBarrier";
import { ensureDefaultRoleGrants } from "../../src/services/roleGrants";
import {
  CLN_PASSWORD,
  cleanupCleaningWorld,
  createCleaningWorld,
  type CleaningWorld,
} from "../cleaning/fixtures";
import {
  closeServer,
  listenApp,
  loginBearer,
  patchJson,
} from "../httpHarness";
import { createEmployeeWithUser } from "../fixtures";
import { getSetting, updateSetting } from "../../src/services/settings";

const prisma = new PrismaClient();
const REPS = 8;

describe("MA-04 concurrent out_of_service", () => {
  let world: CleaningWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let staffAToken: string;
  let staffBToken: string;
  let staffAEmployeeId: string;
  let staffBEmployeeId: string;
  let recipientEmployeeId: string;
  let notifBefore: Awaited<ReturnType<typeof getSetting>>;

  before(async () => {
    await assertTestDatabase(prisma);
    await ensureDefaultRoleGrants();
    world = await createCleaningWorld(prisma);
    ({ server, api } = await listenApp());

    const stamp = world.stamp;
    const staffA = await createEmployeeWithUser(prisma, {
      employeeNumber: `MA04-A-${stamp}`,
      email: `ma04-a-${stamp}@test.local`,
      role: Role.manager,
      fullName: "MA04 Staff A",
      password: CLN_PASSWORD,
    });
    const staffB = await createEmployeeWithUser(prisma, {
      employeeNumber: `MA04-B-${stamp}`,
      email: `ma04-b-${stamp}@test.local`,
      role: Role.manager,
      fullName: "MA04 Staff B",
      password: CLN_PASSWORD,
    });
    const recipient = await createEmployeeWithUser(prisma, {
      employeeNumber: `MA04-R-${stamp}`,
      email: `ma04-r-${stamp}@test.local`,
      role: Role.owner,
      fullName: "MA04 Recipient",
      password: CLN_PASSWORD,
    });
    staffAEmployeeId = staffA.employeeId;
    staffBEmployeeId = staffB.employeeId;
    recipientEmployeeId = recipient.employeeId;
    staffAToken = (await loginBearer(api, staffA.email, CLN_PASSWORD)).token;
    staffBToken = (await loginBearer(api, staffB.email, CLN_PASSWORD)).token;

    notifBefore = await getSetting("notifications");
    await updateSetting({
      key: "notifications",
      value: {
        ...notifBefore,
        in_app: { ...notifBefore.in_app, enabled: true },
      },
      actorEmployeeId: world.owner.employeeId,
      reason: "ma04 enable in-app",
    });
  });

  after(async () => {
    if (notifBefore) {
      await updateSetting({
        key: "notifications",
        value: notifBefore,
        actorEmployeeId: world.owner.employeeId,
        reason: "ma04 restore notifications",
      });
    }
    if (server) await closeServer(server);
    if (world) {
      await prisma.notificationDelivery.deleteMany({
        where: {
          notification: {
            recipientEmployeeId: {
              in: [staffAEmployeeId, staffBEmployeeId, recipientEmployeeId],
            },
          },
        },
      });
      await prisma.notification.deleteMany({
        where: {
          recipientEmployeeId: {
            in: [staffAEmployeeId, staffBEmployeeId, recipientEmployeeId],
          },
        },
      });
      await prisma.authSession.deleteMany({
        where: {
          user: {
            employeeId: {
              in: [staffAEmployeeId, staffBEmployeeId, recipientEmployeeId],
            },
          },
        },
      });
      await prisma.device.deleteMany({
        where: {
          employeeId: {
            in: [staffAEmployeeId, staffBEmployeeId, recipientEmployeeId],
          },
        },
      });
      await prisma.user.deleteMany({
        where: {
          employeeId: {
            in: [staffAEmployeeId, staffBEmployeeId, recipientEmployeeId],
          },
        },
      });
      await prisma.employee.deleteMany({
        where: {
          id: {
            in: [staffAEmployeeId, staffBEmployeeId, recipientEmployeeId],
          },
        },
      });
      await cleanupCleaningWorld(prisma, world);
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.location.update({
      where: { id: world.locationAId },
      data: { serviceStatus: ServiceStatus.in_service },
    });
    await prisma.auditEvent.deleteMany({
      where: {
        locationId: world.locationAId,
        action: "location.set_service_status",
      },
    });
    await prisma.notificationDelivery.deleteMany({
      where: {
        notification: {
          locationId: world.locationAId,
          type: "location.out_of_service",
        },
      },
    });
    await prisma.notification.deleteMany({
      where: {
        locationId: world.locationAId,
        type: "location.out_of_service",
      },
    });
  });

  async function assertSingleTransition() {
    const loc = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(loc.serviceStatus, ServiceStatus.out_of_service);

    const audits = await prisma.auditEvent.findMany({
      where: {
        locationId: world.locationAId,
        action: "location.set_service_status",
      },
      orderBy: { occurredAt: "asc" },
    });
    assert.equal(audits.length, 1, `expected 1 audit, got ${audits.length}`);
    assert.equal(
      (audits[0]!.before as { serviceStatus?: string })?.serviceStatus,
      "in_service",
    );
    assert.equal(
      (audits[0]!.after as { serviceStatus?: string })?.serviceStatus,
      "out_of_service",
    );

    const notes = await prisma.notification.findMany({
      where: {
        recipientEmployeeId: recipientEmployeeId,
        locationId: world.locationAId,
        type: "location.out_of_service",
      },
    });
    assert.equal(
      notes.length,
      1,
      `expected 1 notification for recipient, got ${notes.length}`,
    );
  }

  it("sequential double mark: second is noop, one audit + one notify", async () => {
    const first = await patchJson(
      api,
      staffAToken,
      `/locations/${world.locationAId}/service-status`,
      { serviceStatus: "out_of_service" },
    );
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const second = await patchJson(
      api,
      staffBToken,
      `/locations/${world.locationAId}/service-status`,
      { serviceStatus: "out_of_service" },
    );
    assert.equal(second.status, 200, JSON.stringify(second.body));
    await assertSingleTransition();
  });

  for (let rep = 1; rep <= REPS; rep++) {
    it(`concurrent dual out_of_service records one transition (rep ${rep})`, async () => {
      const settled = await withDatabaseBarrier(
        prisma,
        (tx) =>
          tx.$queryRaw`SELECT id FROM "Location" WHERE id = ${world.locationAId} FOR UPDATE`,
        () =>
          Promise.allSettled([
            patchJson(
              api,
              staffAToken,
              `/locations/${world.locationAId}/service-status`,
              { serviceStatus: "out_of_service" },
            ),
            patchJson(
              api,
              staffBToken,
              `/locations/${world.locationAId}/service-status`,
              { serviceStatus: "out_of_service" },
            ),
          ]),
      );

      for (const row of settled) {
        assert.equal(row.status, "fulfilled");
        const value = row.value as { status: number; body: unknown };
        assert.equal(value.status, 200, JSON.stringify(value.body));
      }
      await assertSingleTransition();
    });
  }

  it("second real OOS after return to in_service creates a new audit", async () => {
    assert.equal(
      (
        await patchJson(
          api,
          staffAToken,
          `/locations/${world.locationAId}/service-status`,
          { serviceStatus: "out_of_service" },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await patchJson(
          api,
          staffAToken,
          `/locations/${world.locationAId}/service-status`,
          { serviceStatus: "in_service" },
        )
      ).status,
      200,
    );
    await prisma.notification.deleteMany({
      where: {
        locationId: world.locationAId,
        type: "location.out_of_service",
      },
    });
    assert.equal(
      (
        await patchJson(
          api,
          staffBToken,
          `/locations/${world.locationAId}/service-status`,
          { serviceStatus: "out_of_service" },
        )
      ).status,
      200,
    );
    const audits = await prisma.auditEvent.count({
      where: {
        locationId: world.locationAId,
        action: "location.set_service_status",
        after: { path: ["serviceStatus"], equals: "out_of_service" },
      },
    });
    assert.equal(audits, 2);
  });
});
