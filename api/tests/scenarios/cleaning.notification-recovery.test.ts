/**
 * session complete must succeed even when inspection notices fail
 * after commit; replay / flush must repair without duplicates.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, it } from "node:test";
import { prisma } from "../../src/db";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  cleanupCleaningWorld,
  createAndStartToday,
  createCleaningWorld,
  type CleaningWorld,
} from "../cleaning/fixtures";
import { completeCleaningSession } from "../../src/services/cleaning";
import { flushCleaningNotificationOutbox } from "../../src/services/cleaning/notificationOutbox";
import { getSetting, updateSetting } from "../../src/services/settings";
import { recipientsForLocationOps } from "../../src/services/notifications";

let world: CleaningWorld;
let settings: Awaited<ReturnType<typeof getSetting<"notifications">>>;

before(async () => {
  await assertTestDatabase(prisma);
  world = await createCleaningWorld(prisma);
  settings = await getSetting("notifications");
  await updateSetting({
    key: "notifications",
    value: {
      ...settings,
      in_app: { ...settings.in_app, enabled: true },
    },
    actorEmployeeId: world.owner.employeeId,
  });
});

beforeEach(async () => {
  await prisma.notification.deleteMany({
    where: { locationId: { in: [world.locationAId, world.locationBId] } },
  });
  await prisma.cleaningNotificationOutbox.deleteMany({});
  await prisma.inspection.deleteMany({
    where: { task: { locationId: { in: [world.locationAId, world.locationBId] } } },
  });
  await prisma.cleaningSession.deleteMany({
    where: { task: { locationId: { in: [world.locationAId, world.locationBId] } } },
  });
  await prisma.cleaningTask.deleteMany({
    where: { locationId: { in: [world.locationAId, world.locationBId] } },
  });
});

after(async () => {
  if (world) {
    await updateSetting({
      key: "notifications",
      value: settings,
      actorEmployeeId: world.owner.employeeId,
    });
    await prisma.notification.deleteMany({
      where: { locationId: { in: [world.locationAId, world.locationBId] } },
    });
    await prisma.cleaningNotificationOutbox.deleteMany({});
    await cleanupCleaningWorld(prisma, world);
  }
  await prisma.$disconnect();
});

async function failSecondRecipient(
  entityId: string,
  secondRecipientId: string,
  action: () => Promise<unknown>,
) {
  const name = `clean_notice_fail_${randomUUID().replaceAll("-", "")}`;
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId" = '${entityId}' AND NEW.type = 'cleaning.needs_inspection' AND NEW."recipientEmployeeId" = '${secondRecipientId}' THEN RAISE EXCEPTION 'cleaning_notification_recovery_test'; END IF; RETURN NEW; END $$`,
  );
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    try {
      await action();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON "Notification"`);
    }
  } finally {
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
  }
}

it("complete stays successful after partial notice failure; replay repairs without duplicates", async () => {
  const { started } = await createAndStartToday(
    world,
    world.locationAId,
    world.hk1.employeeId,
  );
  const recipients = [
    ...new Set([
      ...(await recipientsForLocationOps(world.locationAId, "cleaning.inspect")),
      ...(started.task.sectorSupervisorEmployeeId
        ? [started.task.sectorSupervisorEmployeeId]
        : []),
    ]),
  ].filter((id) => id !== world.hk1.employeeId);
  assert.ok(
    recipients.length >= 2,
    "need at least two inspection recipients for partial-failure case",
  );
  const second = recipients[1]!;
  const commandId = randomUUID();

  await failSecondRecipient(started.task.id, second, () =>
    completeCleaningSession({
      sessionId: started.session.id,
      employeeId: world.hk1.employeeId,
      commandId,
      expectedVersion: started.task.version,
    }),
  );

  const session = await prisma.cleaningSession.findUniqueOrThrow({
    where: { id: started.session.id },
  });
  assert.equal(session.status, "completed");
  const task = await prisma.cleaningTask.findUniqueOrThrow({
    where: { id: started.task.id },
  });
  assert.equal(task.status, "awaiting_inspection");

  const before = await prisma.notification.findMany({
    where: {
      entityId: started.task.id,
      type: "cleaning.needs_inspection",
    },
  });
  assert.ok(before.length >= 1);
  assert.ok(!before.some((n) => n.recipientEmployeeId === second));

  const replay = await completeCleaningSession({
    sessionId: started.session.id,
    employeeId: world.hk1.employeeId,
    commandId,
    expectedVersion: started.task.version,
  });
  assert.equal(replay.idempotent, true);

  const after = await prisma.notification.findMany({
    where: {
      entityId: started.task.id,
      type: "cleaning.needs_inspection",
    },
  });
  assert.deepEqual(
    after.map((n) => n.recipientEmployeeId).sort(),
    recipients.sort(),
  );
  assert.equal(new Set(after.map((n) => n.dedupeKey)).size, 1);
  assert.equal(
    after.find((n) => n.recipientEmployeeId === before[0]!.recipientEmployeeId)!
      .id,
    before[0]!.id,
  );
});

it("early idempotent replay keeps complete success when deliver still fails", async () => {
  const { started } = await createAndStartToday(
    world,
    world.locationAId,
    world.hk1.employeeId,
  );
  const recipients = [
    ...new Set([
      ...(await recipientsForLocationOps(world.locationAId, "cleaning.inspect")),
      ...(started.task.sectorSupervisorEmployeeId
        ? [started.task.sectorSupervisorEmployeeId]
        : []),
    ]),
  ].filter((id) => id !== world.hk1.employeeId);
  assert.ok(recipients.length >= 1);
  const commandId = randomUUID();
  const blockAll = recipients[0]!;

  // First complete: domain commits; notices partially/fully blocked.
  await failSecondRecipient(started.task.id, blockAll, () =>
    completeCleaningSession({
      sessionId: started.session.id,
      employeeId: world.hk1.employeeId,
      commandId,
      expectedVersion: started.task.version,
    }),
  );

  const session = await prisma.cleaningSession.findUniqueOrThrow({
    where: { id: started.session.id },
  });
  assert.equal(session.status, "completed");

  // Keep delivery broken on early replay path — must still return success.
  const name = `clean_notice_fail_all_${randomUUID().replaceAll("-", "")}`;
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId" = '${started.task.id}' AND NEW.type = 'cleaning.needs_inspection' THEN RAISE EXCEPTION 'cleaning_early_replay_deliver_fail'; END IF; RETURN NEW; END $$`,
  );
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    const replay = await completeCleaningSession({
      sessionId: started.session.id,
      employeeId: world.hk1.employeeId,
      commandId,
      expectedVersion: started.task.version,
    });
    assert.equal(replay.idempotent, true);
    assert.equal(
      (await prisma.cleaningSession.findUniqueOrThrow({ where: { id: started.session.id } }))
        .status,
      "completed",
    );
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "Notification"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
  }

  const flushed = await flushCleaningNotificationOutbox();
  assert.equal(flushed.pending, 0);
  const rows = await prisma.notification.findMany({
    where: {
      entityId: started.task.id,
      type: "cleaning.needs_inspection",
    },
  });
  assert.deepEqual(
    rows.map((n) => n.recipientEmployeeId).sort(),
    recipients.sort(),
  );
});

it("background flush delivers undelivered cleaning inspection intents", async () => {
  const { started } = await createAndStartToday(
    world,
    world.locationAId,
    world.hk1.employeeId,
  );
  const recipients = [
    ...new Set([
      ...(await recipientsForLocationOps(world.locationAId, "cleaning.inspect")),
      ...(started.task.sectorSupervisorEmployeeId
        ? [started.task.sectorSupervisorEmployeeId]
        : []),
    ]),
  ].filter((id) => id !== world.hk1.employeeId);
  assert.ok(recipients.length >= 2);
  const second = recipients[1]!;
  const commandId = randomUUID();

  await failSecondRecipient(started.task.id, second, () =>
    completeCleaningSession({
      sessionId: started.session.id,
      employeeId: world.hk1.employeeId,
      commandId,
      expectedVersion: started.task.version,
    }),
  );

  const result = await flushCleaningNotificationOutbox();
  assert.equal(result.pending, 0);
  const rows = await prisma.notification.findMany({
    where: {
      entityId: started.task.id,
      type: "cleaning.needs_inspection",
    },
  });
  assert.deepEqual(
    rows.map((n) => n.recipientEmployeeId).sort(),
    recipients.sort(),
  );
  assert.equal((await flushCleaningNotificationOutbox()).delivered, 0);
});
