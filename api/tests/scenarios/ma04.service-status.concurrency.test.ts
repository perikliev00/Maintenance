/**
 * MA-04 — two staff marking the same room out of service record and notify one transition.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  Role,
  // Execute the next setup or assertion step for this scenario.
  ServiceStatus,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { withDatabaseBarrier } from "../dbBarrier";
// Import bindings from ../../src/services/roleGrants.
import { ensureDefaultRoleGrants } from "../../src/services/roleGrants";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  cleanupCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  createCleaningWorld,
  // Shape CleaningWorld documents the fixture/response fields this suite touches.
  type CleaningWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../cleaning/fixtures";
// Import module bindings used by this suite.
import {
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  patchJson,
// Execute the next setup or assertion step for this scenario.
} from "../httpHarness";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createEmployeeWithUser } from "../fixtures";
// Import bindings from ../../src/services/settings.
import { getSetting, updateSetting } from "../../src/services/settings";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();
// REPS: repetition count to amplify race windows.
const REPS = 8;

// Suite: MA-04 concurrent out_of_service.
describe("MA-04 concurrent out_of_service", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: CleaningWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Execute the next setup or assertion step for this scenario.
  let staffAToken: string;
  // Execute the next setup or assertion step for this scenario.
  let staffBToken: string;
  // Execute the next setup or assertion step for this scenario.
  let staffAEmployeeId: string;
  // Execute the next setup or assertion step for this scenario.
  let staffBEmployeeId: string;
  // Execute the next setup or assertion step for this scenario.
  let recipientEmployeeId: string;
  // Delivery/replay step for async notification paths.
  let notifBefore: Awaited<ReturnType<typeof getSetting>>;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Await async work before asserting or releasing locks.
    await ensureDefaultRoleGrants();
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());

    // stamp: unique stamp so parallel runs do not collide.
    const stamp = world.stamp;
    // staffA: seeded entity required before the mutation under test.
    const staffA = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `MA04-A-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `ma04-a-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.manager,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "MA04 Staff A",
      // Fixture field password for the seeded actor/entity.
      password: CLN_PASSWORD,
    });
    // staffB: seeded entity required before the mutation under test.
    const staffB = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `MA04-B-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `ma04-b-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.manager,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "MA04 Staff B",
      // Fixture field password for the seeded actor/entity.
      password: CLN_PASSWORD,
    });
    // recipient: seeded entity required before the mutation under test.
    const recipient = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `MA04-R-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `ma04-r-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.owner,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "MA04 Recipient",
      // Fixture field password for the seeded actor/entity.
      password: CLN_PASSWORD,
    });
    // Execute the next setup or assertion step for this scenario.
    staffAEmployeeId = staffA.employeeId;
    // Execute the next setup or assertion step for this scenario.
    staffBEmployeeId = staffB.employeeId;
    // Execute the next setup or assertion step for this scenario.
    recipientEmployeeId = recipient.employeeId;
    // Await async work before asserting or releasing locks.
    staffAToken = (await loginBearer(api, staffA.email, CLN_PASSWORD)).token;
    // Await async work before asserting or releasing locks.
    staffBToken = (await loginBearer(api, staffB.email, CLN_PASSWORD)).token;

    // Await async work before asserting or releasing locks.
    notifBefore = await getSetting("notifications");
    // Await async work before asserting or releasing locks.
    await updateSetting({
      // Delivery/replay step for async notification paths.
      key: "notifications",
      // Execute the next setup or assertion step for this scenario.
      value: {
        // Continue the call chain for setup or assertion detail.
        ...notifBefore,
        // Delivery/replay step for async notification paths.
        in_app: { ...notifBefore.in_app, enabled: true },
      },
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "ma04 enable in-app",
    });
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (notifBefore) {
      // Await async work before asserting or releasing locks.
      await updateSetting({
        // Delivery/replay step for async notification paths.
        key: "notifications",
        // Delivery/replay step for async notification paths.
        value: notifBefore,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
        // Delivery/replay step for async notification paths.
        reason: "ma04 restore notifications",
      });
    }
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) {
      // Await async work before asserting or releasing locks.
      await prisma.notificationDelivery.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Delivery/replay step for async notification paths.
          notification: {
            // Execute the next setup or assertion step for this scenario.
            recipientEmployeeId: {
              // Execute the next setup or assertion step for this scenario.
              in: [staffAEmployeeId, staffBEmployeeId, recipientEmployeeId],
            },
          },
        },
      });
      // Await async work before asserting or releasing locks.
      await prisma.notification.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Execute the next setup or assertion step for this scenario.
          recipientEmployeeId: {
            // Execute the next setup or assertion step for this scenario.
            in: [staffAEmployeeId, staffBEmployeeId, recipientEmployeeId],
          },
        },
      });
      // Await async work before asserting or releasing locks.
      await prisma.authSession.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Execute the next setup or assertion step for this scenario.
          user: {
            // Execute the next setup or assertion step for this scenario.
            employeeId: {
              // Execute the next setup or assertion step for this scenario.
              in: [staffAEmployeeId, staffBEmployeeId, recipientEmployeeId],
            },
          },
        },
      });
      // Await async work before asserting or releasing locks.
      await prisma.device.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Execute the next setup or assertion step for this scenario.
          employeeId: {
            // Execute the next setup or assertion step for this scenario.
            in: [staffAEmployeeId, staffBEmployeeId, recipientEmployeeId],
          },
        },
      });
      // Await async work before asserting or releasing locks.
      await prisma.user.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Execute the next setup or assertion step for this scenario.
          employeeId: {
            // Execute the next setup or assertion step for this scenario.
            in: [staffAEmployeeId, staffBEmployeeId, recipientEmployeeId],
          },
        },
      });
      // Await async work before asserting or releasing locks.
      await prisma.employee.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Execute the next setup or assertion step for this scenario.
          id: {
            // Execute the next setup or assertion step for this scenario.
            in: [staffAEmployeeId, staffBEmployeeId, recipientEmployeeId],
          },
        },
      });
      // Await async work before asserting or releasing locks.
      await cleanupCleaningWorld(prisma, world);
    }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await prisma.location.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
      // Execute the next setup or assertion step for this scenario.
      data: { serviceStatus: ServiceStatus.in_service },
    });
    // Await async work before asserting or releasing locks.
    await prisma.auditEvent.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        action: "location.set_service_status",
      },
    });
    // Await async work before asserting or releasing locks.
    await prisma.notificationDelivery.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Delivery/replay step for async notification paths.
        notification: {
          // Execute the next setup or assertion step for this scenario.
          locationId: world.locationAId,
          // Execute the next setup or assertion step for this scenario.
          type: "location.out_of_service",
        },
      },
    });
    // Await async work before asserting or releasing locks.
    await prisma.notification.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        type: "location.out_of_service",
      },
    });
  });

  // Helper assertSingleTransition: assert expected post-condition.
  async function assertSingleTransition() {
    // loc: synchronize actors so the race window is observable.
    const loc = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.serviceStatus, ServiceStatus.out_of_service);

    // audits: synchronize actors so the race window is observable.
    const audits = await prisma.auditEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        action: "location.set_service_status",
      },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { occurredAt: "asc" },
    });
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.equal(audits.length, 1, `expected 1 audit, got ${audits.length}`);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      (audits[0]!.before as { serviceStatus?: string })?.serviceStatus,
      // Execute the next setup or assertion step for this scenario.
      "in_service",
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      (audits[0]!.after as { serviceStatus?: string })?.serviceStatus,
      // Execute the next setup or assertion step for this scenario.
      "out_of_service",
    );

    // notes: synchronize actors so the race window is observable.
    const notes = await prisma.notification.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        recipientEmployeeId: recipientEmployeeId,
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        type: "location.out_of_service",
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      notes.length,
      1,
      // Delivery/replay step for async notification paths.
      `expected 1 notification for recipient, got ${notes.length}`,
    );
  }

  // Case: sequential double mark: second is noop, one audit + one notify.
  it("sequential double mark: second is noop, one audit + one notify", async () => {
    // first: HTTP response captured for status/body checks.
    const first = await patchJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      staffAToken,
      // Execute the next setup or assertion step for this scenario.
      `/locations/${world.locationAId}/service-status`,
      // Execute the next setup or assertion step for this scenario.
      { serviceStatus: "out_of_service" },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(first.status, 200, JSON.stringify(first.body));
    // second: HTTP response captured for status/body checks.
    const second = await patchJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      staffBToken,
      // Execute the next setup or assertion step for this scenario.
      `/locations/${world.locationAId}/service-status`,
      // Execute the next setup or assertion step for this scenario.
      { serviceStatus: "out_of_service" },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(second.status, 200, JSON.stringify(second.body));
    // Await async work before asserting or releasing locks.
    await assertSingleTransition();
  });

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let rep = 1; rep <= REPS; rep++) {
    // Case probes concurrency/isolation: concurrent dual out_of_service records one transition (rep ${rep}).
    it(`concurrent dual out_of_service records one transition (rep ${rep})`, async () => {
      // settled: synchronize actors so the race window is observable.
      const settled = await withDatabaseBarrier(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Execute the next setup or assertion step for this scenario.
        (tx) =>
          // Execute the next setup or assertion step for this scenario.
          tx.$queryRaw`SELECT id FROM "Location" WHERE id = ${world.locationAId} FOR UPDATE`,
        // Execute the next setup or assertion step for this scenario.
        () =>
          // Run actors together to expose races and serialization bugs.
          Promise.allSettled([
            // Execute the next setup or assertion step for this scenario.
            patchJson(
              // Execute the next setup or assertion step for this scenario.
              api,
              // Execute the next setup or assertion step for this scenario.
              staffAToken,
              // Execute the next setup or assertion step for this scenario.
              `/locations/${world.locationAId}/service-status`,
              // Execute the next setup or assertion step for this scenario.
              { serviceStatus: "out_of_service" },
            ),
            // Execute the next setup or assertion step for this scenario.
            patchJson(
              // Execute the next setup or assertion step for this scenario.
              api,
              // Execute the next setup or assertion step for this scenario.
              staffBToken,
              // Execute the next setup or assertion step for this scenario.
              `/locations/${world.locationAId}/service-status`,
              // Execute the next setup or assertion step for this scenario.
              { serviceStatus: "out_of_service" },
            ),
          ]),
      );

      // Iterate to cover variants or wait until a condition holds.
      for (const row of settled) {
        // Assert HTTP status matches the contract for this path.
        assert.equal(row.status, "fulfilled");
        // Bind value for later setup or assertions in this scope.
        const value = row.value as { status: number; body: unknown };
        // Assert HTTP status matches the contract for this path.
        assert.equal(value.status, 200, JSON.stringify(value.body));
      }
      // Await async work before asserting or releasing locks.
      await assertSingleTransition();
    });
  }

  // Case: second real OOS after return to in_service creates a new audit.
  it("second real OOS after return to in_service creates a new audit", async () => {
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      (
        // Await async work before asserting or releasing locks.
        await patchJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          staffAToken,
          // Execute the next setup or assertion step for this scenario.
          `/locations/${world.locationAId}/service-status`,
          // Execute the next setup or assertion step for this scenario.
          { serviceStatus: "out_of_service" },
        )
      // Execute the next setup or assertion step for this scenario.
      ).status,
      // Execute the next setup or assertion step for this scenario.
      200,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      (
        // Await async work before asserting or releasing locks.
        await patchJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          staffAToken,
          // Execute the next setup or assertion step for this scenario.
          `/locations/${world.locationAId}/service-status`,
          // Execute the next setup or assertion step for this scenario.
          { serviceStatus: "in_service" },
        )
      // Execute the next setup or assertion step for this scenario.
      ).status,
      // Execute the next setup or assertion step for this scenario.
      200,
    );
    // Await async work before asserting or releasing locks.
    await prisma.notification.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        type: "location.out_of_service",
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      (
        // Await async work before asserting or releasing locks.
        await patchJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          staffBToken,
          // Execute the next setup or assertion step for this scenario.
          `/locations/${world.locationAId}/service-status`,
          // Execute the next setup or assertion step for this scenario.
          { serviceStatus: "out_of_service" },
        )
      // Execute the next setup or assertion step for this scenario.
      ).status,
      // Execute the next setup or assertion step for this scenario.
      200,
    );
    // audits: synchronize actors so the race window is observable.
    const audits = await prisma.auditEvent.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        action: "location.set_service_status",
        // Execute the next setup or assertion step for this scenario.
        after: { path: ["serviceStatus"], equals: "out_of_service" },
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(audits, 2);
  });
});
