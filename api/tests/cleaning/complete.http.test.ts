/**
 * HTTP — cleaning assignee bypass aligned with tickets .
 * Deny foreign housekeeper; allow manager complete bypass; assignee can complete own.
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { GrantKind, PrismaClient, Role, SessionStatus } from "@prisma/client";
import dotenv from "dotenv";
import { createCleaningTask } from "../../src/services/cleaning";
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
  hotelTodayYmd,
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

describe("cleaning complete HTTP", () => {
  let world: CleaningWorld;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let api = "";

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await ensureDefaultRoleGrants();
    for (const key of ["cleaning.start", "cleaning.complete"] as const) {
      await prisma.roleGrant.upsert({
        where: {
          role_kind_key: { role: Role.manager, kind: GrantKind.action, key },
        },
        create: { role: Role.manager, kind: GrantKind.action, key },
        update: {},
      });
    }
    invalidateGrantCache();
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

  it("-http: foreign HK denied; manager bypasses complete; assignee completes own", async () => {
    await resetCleaningWork(prisma, world);
    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });

    const { token: hk2Token } = await loginBearer(
      api,
      world.hk2.email,
      CLN_PASSWORD,
    );
    const foreignStart = await postJson(
      api,
      hk2Token,
      `/cleaning/tasks/${task.id}/start`,
      { commandId: randomUUID(), expectedVersion: task.version },
    );
    // Scope denial (403) or assignee_conflict (409) are both valid deny paths.
    assert.ok(
      foreignStart.status === 403 || foreignStart.status === 409,
      JSON.stringify(foreignStart.body),
    );

    await resetCleaningWork(prisma, world);
    const { started } = await createAndStartToday(
      world,
      world.locationAId,
      world.hk1.employeeId,
    );

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
    assert.equal(managerRes.status, 200, JSON.stringify(managerRes.body));
    const managerBody = managerRes.body as {
      session?: { employeeId?: string; completeActorEmployeeId?: string };
    };
    assert.equal(managerBody.session?.employeeId, world.hk1.employeeId);
    assert.equal(
      managerBody.session?.completeActorEmployeeId,
      world.manager.employeeId,
    );

    await resetCleaningWork(prisma, world);
    const own = await createAndStartToday(
      world,
      world.locationAId,
      world.hk1.employeeId,
    );
    const { token: hk1Token } = await loginBearer(
      api,
      world.hk1.email,
      CLN_PASSWORD,
    );
    const ownRes = await postJson(
      api,
      hk1Token,
      `/cleaning/sessions/${own.started.session.id}/complete`,
      {
        commandId: randomUUID(),
        expectedVersion: own.started.task.version,
      },
    );
    assert.equal(ownRes.status, 200, JSON.stringify(ownRes.body));
    const done = await prisma.cleaningSession.findUniqueOrThrow({
      where: { id: own.started.session.id },
    });
    assert.equal(done.status, SessionStatus.completed);
  });
});
