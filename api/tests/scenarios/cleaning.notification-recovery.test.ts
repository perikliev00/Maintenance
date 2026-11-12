/**
 * session complete must succeed even when inspection notices fail
 * after commit; replay / flush must repair without duplicates.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, it } from "node:test";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  createAndStartToday,
  // Execute the next setup or assertion step for this scenario.
  createCleaningWorld,
  // Shape CleaningWorld documents the fixture/response fields this suite touches.
  type CleaningWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../cleaning/fixtures";
// Import bindings from ../../src/services/cleaning.
import { completeCleaningSession } from "../../src/services/cleaning";
// Import bindings from ../../src/services/cleaning/notificationOutbox.
import { flushCleaningNotificationOutbox } from "../../src/services/cleaning/notificationOutbox";
// Import bindings from ../../src/services/settings.
import { getSetting, updateSetting } from "../../src/services/settings";
// Import bindings from ../../src/services/notifications.
import { recipientsForLocationOps } from "../../src/services/notifications";

// Execute the next setup or assertion step for this scenario.
let world: CleaningWorld;
// Delivery/replay step for async notification paths.
let settings: Awaited<ReturnType<typeof getSetting<"notifications">>>;

// Arrange shared preconditions before cases run.
before(async () => {
  // Refuse to mutate unless connected to the isolated test database.
  await assertTestDatabase(prisma);
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  world = await createCleaningWorld(prisma);
  // Await async work before asserting or releasing locks.
  settings = await getSetting("notifications");
  // Await async work before asserting or releasing locks.
  await updateSetting({
    // Delivery/replay step for async notification paths.
    key: "notifications",
    // Execute the next setup or assertion step for this scenario.
    value: {
      // Continue the call chain for setup or assertion detail.
      ...settings,
      // Execute the next setup or assertion step for this scenario.
      in_app: { ...settings.in_app, enabled: true },
    },
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId: world.owner.employeeId,
  });
});

// Arrange shared preconditions before cases run.
beforeEach(async () => {
  // Await async work before asserting or releasing locks.
  await prisma.notification.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: [world.locationAId, world.locationBId] } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.cleaningNotificationOutbox.deleteMany({});
  // Await async work before asserting or releasing locks.
  await prisma.inspection.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { task: { locationId: { in: [world.locationAId, world.locationBId] } } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.cleaningSession.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { task: { locationId: { in: [world.locationAId, world.locationBId] } } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.cleaningTask.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: [world.locationAId, world.locationBId] } },
  });
});

// Release servers/DB clients so later suites stay isolated.
after(async () => {
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (world) {
    // Await async work before asserting or releasing locks.
    await updateSetting({
      // Delivery/replay step for async notification paths.
      key: "notifications",
      // Execute the next setup or assertion step for this scenario.
      value: settings,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
    });
    // Await async work before asserting or releasing locks.
    await prisma.notification.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { locationId: { in: [world.locationAId, world.locationBId] } },
    });
    // Await async work before asserting or releasing locks.
    await prisma.cleaningNotificationOutbox.deleteMany({});
    // Await async work before asserting or releasing locks.
    await cleanupCleaningWorld(prisma, world);
  }
  // Disconnect Prisma so the pool does not leak across suites.
  await prisma.$disconnect();
});

// Local helper failSecondRecipient used by cases in this file.
async function failSecondRecipient(
  // Execute the next setup or assertion step for this scenario.
  entityId: string,
  // Execute the next setup or assertion step for this scenario.
  secondRecipientId: string,
  // Execute the next setup or assertion step for this scenario.
  action: () => Promise<unknown>,
// Execute the next setup or assertion step for this scenario.
) {
  // name: unique stamp so parallel runs do not collide.
  const name = `clean_notice_fail_${randomUUID().replaceAll("-", "")}`;
  // Await async work before asserting or releasing locks.
  await prisma.$executeRawUnsafe(
    // Delivery/replay step for async notification paths.
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId" = '${entityId}' AND NEW.type = 'cleaning.needs_inspection' AND NEW."recipientEmployeeId" = '${secondRecipientId}' THEN RAISE EXCEPTION 'cleaning_notification_recovery_test'; END IF; RETURN NEW; END $$`,
  );
  // Try path where partial failure must not leak suite state.
  try {
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(
      // Delivery/replay step for async notification paths.
      `CREATE TRIGGER ${name} BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await action();
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON "Notification"`);
    }
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
  }
}

// Case: complete stays successful after partial notice failure; replay repairs without duplicates.
it("complete stays successful after partial notice failure; replay repairs without duplicates", async () => {
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  const { started } = await createAndStartToday(
    // Execute the next setup or assertion step for this scenario.
    world,
    // Execute the next setup or assertion step for this scenario.
    world.locationAId,
    // Execute the next setup or assertion step for this scenario.
    world.hk1.employeeId,
  );
  // Bind recipients for later setup or assertions in this scope.
  const recipients = [
    // Continue the call chain for setup or assertion detail.
    ...new Set([
      // Await async work before asserting or releasing locks.
      ...(await recipientsForLocationOps(world.locationAId, "cleaning.inspect")),
      // Continue the call chain for setup or assertion detail.
      ...(started.task.sectorSupervisorEmployeeId
        ? [started.task.sectorSupervisorEmployeeId]
        : []),
    ]),
  // Execute the next setup or assertion step for this scenario.
  ].filter((id) => id !== world.hk1.employeeId);
  // Assert the observed value matches the intended post-condition.
  assert.ok(
    // Execute the next setup or assertion step for this scenario.
    recipients.length >= 2,
    // Execute the next setup or assertion step for this scenario.
    "need at least two inspection recipients for partial-failure case",
  );
  // Bind second for later setup or assertions in this scope.
  const second = recipients[1]!;
  // commandId: unique stamp so parallel runs do not collide.
  const commandId = randomUUID();

  // Await async work before asserting or releasing locks.
  await failSecondRecipient(started.task.id, second, () =>
    // Session/CSRF step exercising auth lifecycle.
    completeCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: started.session.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: started.task.version,
    }),
  );

  // session: session cookie jar for authenticated requests.
  const session = await prisma.cleaningSession.findUniqueOrThrow({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: started.session.id },
  });
  // Assert HTTP status matches the contract for this path.
  assert.equal(session.status, "completed");
  // task: synchronize actors so the race window is observable.
  const task = await prisma.cleaningTask.findUniqueOrThrow({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: started.task.id },
  });
  // Assert HTTP status matches the contract for this path.
  assert.equal(task.status, "awaiting_inspection");

  // before: synchronize actors so the race window is observable.
  const before = await prisma.notification.findMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      entityId: started.task.id,
      // Execute the next setup or assertion step for this scenario.
      type: "cleaning.needs_inspection",
    },
  });
  // Assert collection size matches the expected post-condition.
  assert.ok(before.length >= 1);
  // Assert the observed value matches the intended post-condition.
  assert.ok(!before.some((n) => n.recipientEmployeeId === second));

  // replay: synchronize actors so the race window is observable.
  const replay = await completeCleaningSession({
    // Session/CSRF step exercising auth lifecycle.
    sessionId: started.session.id,
    // Execute the next setup or assertion step for this scenario.
    employeeId: world.hk1.employeeId,
    // Execute the next setup or assertion step for this scenario.
    commandId,
    // Execute the next setup or assertion step for this scenario.
    expectedVersion: started.task.version,
  });
  // Assert replay/idempotent path did not create duplicates.
  assert.equal(replay.idempotent, true);

  // after: synchronize actors so the race window is observable.
  const after = await prisma.notification.findMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      entityId: started.task.id,
      // Execute the next setup or assertion step for this scenario.
      type: "cleaning.needs_inspection",
    },
  });
  // Assert the observed value matches the intended post-condition.
  assert.deepEqual(
    // Execute the next setup or assertion step for this scenario.
    after.map((n) => n.recipientEmployeeId).sort(),
    // Execute the next setup or assertion step for this scenario.
    recipients.sort(),
  );
  // Assert the observed value matches the intended post-condition.
  assert.equal(new Set(after.map((n) => n.dedupeKey)).size, 1);
  // Assert the observed value matches the intended post-condition.
  assert.equal(
    // Execute the next setup or assertion step for this scenario.
    after.find((n) => n.recipientEmployeeId === before[0]!.recipientEmployeeId)!
      // Continue the call chain for setup or assertion detail.
      .id,
    // Execute the next setup or assertion step for this scenario.
    before[0]!.id,
  );
});

// Case checks idempotent replay safety: early idempotent replay keeps complete success when deliver still fails.
it("early idempotent replay keeps complete success when deliver still fails", async () => {
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  const { started } = await createAndStartToday(
    // Execute the next setup or assertion step for this scenario.
    world,
    // Execute the next setup or assertion step for this scenario.
    world.locationAId,
    // Execute the next setup or assertion step for this scenario.
    world.hk1.employeeId,
  );
  // Bind recipients for later setup or assertions in this scope.
  const recipients = [
    // Continue the call chain for setup or assertion detail.
    ...new Set([
      // Await async work before asserting or releasing locks.
      ...(await recipientsForLocationOps(world.locationAId, "cleaning.inspect")),
      // Continue the call chain for setup or assertion detail.
      ...(started.task.sectorSupervisorEmployeeId
        ? [started.task.sectorSupervisorEmployeeId]
        : []),
    ]),
  // Execute the next setup or assertion step for this scenario.
  ].filter((id) => id !== world.hk1.employeeId);
  // Assert collection size matches the expected post-condition.
  assert.ok(recipients.length >= 1);
  // commandId: unique stamp so parallel runs do not collide.
  const commandId = randomUUID();
  // Bind blockAll for later setup or assertions in this scope.
  const blockAll = recipients[0]!;

  // First complete: domain commits; notices partially/fully blocked.
  await failSecondRecipient(started.task.id, blockAll, () =>
    // Session/CSRF step exercising auth lifecycle.
    completeCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: started.session.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: started.task.version,
    }),
  );

  // session: session cookie jar for authenticated requests.
  const session = await prisma.cleaningSession.findUniqueOrThrow({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: started.session.id },
  });
  // Assert HTTP status matches the contract for this path.
  assert.equal(session.status, "completed");

  // Keep delivery broken on early replay path — must still return success.
  const name = `clean_notice_fail_all_${randomUUID().replaceAll("-", "")}`;
  // Await async work before asserting or releasing locks.
  await prisma.$executeRawUnsafe(
    // Delivery/replay step for async notification paths.
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId" = '${started.task.id}' AND NEW.type = 'cleaning.needs_inspection' THEN RAISE EXCEPTION 'cleaning_early_replay_deliver_fail'; END IF; RETURN NEW; END $$`,
  );
  // Try path where partial failure must not leak suite state.
  try {
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(
      // Delivery/replay step for async notification paths.
      `CREATE TRIGGER ${name} BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    // replay: synchronize actors so the race window is observable.
    const replay = await completeCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: started.session.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: started.task.version,
    });
    // Assert replay/idempotent path did not create duplicates.
    assert.equal(replay.idempotent, true);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      (await prisma.cleaningSession.findUniqueOrThrow({ where: { id: started.session.id } }))
        // Continue the call chain for setup or assertion detail.
        .status,
      // Execute the next setup or assertion step for this scenario.
      "completed",
    );
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "Notification"`);
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
  }

  // flushed: synchronize actors so the race window is observable.
  const flushed = await flushCleaningNotificationOutbox();
  // Assert the observed value matches the intended post-condition.
  assert.equal(flushed.pending, 0);
  // rows: synchronize actors so the race window is observable.
  const rows = await prisma.notification.findMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      entityId: started.task.id,
      // Execute the next setup or assertion step for this scenario.
      type: "cleaning.needs_inspection",
    },
  });
  // Assert the observed value matches the intended post-condition.
  assert.deepEqual(
    // Execute the next setup or assertion step for this scenario.
    rows.map((n) => n.recipientEmployeeId).sort(),
    // Execute the next setup or assertion step for this scenario.
    recipients.sort(),
  );
});

// Case: background flush delivers undelivered cleaning inspection intents.
it("background flush delivers undelivered cleaning inspection intents", async () => {
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  const { started } = await createAndStartToday(
    // Execute the next setup or assertion step for this scenario.
    world,
    // Execute the next setup or assertion step for this scenario.
    world.locationAId,
    // Execute the next setup or assertion step for this scenario.
    world.hk1.employeeId,
  );
  // Bind recipients for later setup or assertions in this scope.
  const recipients = [
    // Continue the call chain for setup or assertion detail.
    ...new Set([
      // Await async work before asserting or releasing locks.
      ...(await recipientsForLocationOps(world.locationAId, "cleaning.inspect")),
      // Continue the call chain for setup or assertion detail.
      ...(started.task.sectorSupervisorEmployeeId
        ? [started.task.sectorSupervisorEmployeeId]
        : []),
    ]),
  // Execute the next setup or assertion step for this scenario.
  ].filter((id) => id !== world.hk1.employeeId);
  // Assert collection size matches the expected post-condition.
  assert.ok(recipients.length >= 2);
  // Bind second for later setup or assertions in this scope.
  const second = recipients[1]!;
  // commandId: unique stamp so parallel runs do not collide.
  const commandId = randomUUID();

  // Await async work before asserting or releasing locks.
  await failSecondRecipient(started.task.id, second, () =>
    // Session/CSRF step exercising auth lifecycle.
    completeCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: started.session.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: started.task.version,
    }),
  );

  // result: synchronize actors so the race window is observable.
  const result = await flushCleaningNotificationOutbox();
  // Assert the observed value matches the intended post-condition.
  assert.equal(result.pending, 0);
  // rows: synchronize actors so the race window is observable.
  const rows = await prisma.notification.findMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      entityId: started.task.id,
      // Execute the next setup or assertion step for this scenario.
      type: "cleaning.needs_inspection",
    },
  });
  // Assert the observed value matches the intended post-condition.
  assert.deepEqual(
    // Execute the next setup or assertion step for this scenario.
    rows.map((n) => n.recipientEmployeeId).sort(),
    // Execute the next setup or assertion step for this scenario.
    recipients.sort(),
  );
  // Assert the observed value matches the intended post-condition.
  assert.equal((await flushCleaningNotificationOutbox()).delivered, 0);
});
