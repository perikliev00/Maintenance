/**
 * T-CLN-16 HTTP — owner foreign-complete bypass vs manager denial.
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { GrantKind, PrismaClient, Role, SessionStatus } from "@prisma/client";
import dotenv from "dotenv";
import {
  ensureDefaultRoleGrants,
  invalidateGrantCache,
} from "../../src/services/roleGrants";
import {
  closeServer,
  listenApp,
  loginBearer,
  postJson,
} from "../httpHarness";
import {
  CLN_PASSWORD,
  cleanupCleaningWorld,
  createAndStartToday,
  createCleaningWorld,
  resetCleaningWork,
  type CleaningWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-for-cleaning-complete-http";

const prisma = new PrismaClient();

describe("cleaning complete HTTP (T-CLN-16)", () => {
  let world: CleaningWorld;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let api = "";

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await ensureDefaultRoleGrants();
    world = await createCleaningWorld(prisma);
    const listened = await listenApp();
    server = listened.server;
    api = listened.api;
  });

  after(async () => {
    if (server) await closeServer(server);
    if (world) await cleanupCleaningWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("T-CLN-16-http: owner may complete HK session; manager with complete action may not", async () => {
    await resetCleaningWork(prisma, world);
    const { started } = await createAndStartToday(
      world,
      world.locationAId,
      world.hk1.employeeId,
    );

    // Temporarily grant cleaning.complete so the denial is ownership, not RBAC.
    await prisma.roleGrant.upsert({
      where: {
        role_kind_key: {
          role: Role.manager,
          kind: GrantKind.action,
          key: "cleaning.complete",
        },
      },
      create: {
        role: Role.manager,
        kind: GrantKind.action,
        key: "cleaning.complete",
      },
      update: {},
    });
    invalidateGrantCache();

    try {
      const { token: managerToken } = await loginBearer(
        api,
        world.manager.email,
        CLN_PASSWORD,
      );
      const managerRes = await postJson(
        api,
        managerToken,
        `/cleaning/sessions/${started.session.id}/complete`,
        {
          commandId: randomUUID(),
          expectedVersion: started.task.version,
        },
      );
      assert.equal(managerRes.status, 409, JSON.stringify(managerRes.body));
      assert.equal(
        (managerRes.body as { error?: string }).error,
        "assignee_conflict",
      );

      const stillRunning = await prisma.cleaningSession.findUniqueOrThrow({
        where: { id: started.session.id },
      });
      assert.equal(stillRunning.status, SessionStatus.running);

      // Owner role sets bypassSessionOwnerCheck in the controller.
      const { token: ownerToken } = await loginBearer(
        api,
        world.owner.email,
        CLN_PASSWORD,
      );
      const ownerRes = await postJson(
        api,
        ownerToken,
        `/cleaning/sessions/${started.session.id}/complete`,
        {
          commandId: randomUUID(),
          expectedVersion: started.task.version,
        },
      );
      assert.equal(ownerRes.status, 200, JSON.stringify(ownerRes.body));
      const body = ownerRes.body as {
        session?: { employeeId?: string; completeActorEmployeeId?: string };
      };
      assert.equal(body.session?.employeeId, world.hk1.employeeId);
      assert.equal(
        body.session?.completeActorEmployeeId,
        world.owner.employeeId,
      );
    } finally {
      await prisma.roleGrant.deleteMany({
        where: {
          role: Role.manager,
          kind: GrantKind.action,
          key: "cleaning.complete",
        },
      });
      invalidateGrantCache();
    }
  });
});
