/**
 * CODE-06: permanent failures must not starve newer valid outbox intents.
 * Uses CleaningNotificationOutbox (no TicketEvent FK) for disposable rows.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
import { flushCleaningNotificationOutbox } from "../../src/services/cleaning/notificationOutbox";
import { getSetting, updateSetting } from "../../src/services/settings";
import {
  createScopeSmokeFixture,
  cleanupScopeSmokeFixture,
  // Shape ScopeSmokeFixture documents the fixture/response fields this suite touches.
  type ScopeSmokeFixture,
} from "../fixtures";

const PREFIX = `starve_${randomUUID().slice(0, 8)}_`;

// Suite: notification outbox starvation / retry.
describe("notification outbox starvation / retry", () => {
  let fx: ScopeSmokeFixture;
  let settings: Awaited<ReturnType<typeof getSetting<"notifications">>>;

  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    fx = await createScopeSmokeFixture(prisma);
    settings = await getSetting("notifications");
    await updateSetting({
      key: "notifications",
      value: {
        ...settings,
        in_app: { ...settings.in_app, enabled: true },
      },
      actorEmployeeId: fx.manager.employeeId,
    });
  });

  after(async () => {
    await prisma.cleaningNotificationOutbox.deleteMany({
      where: { commandId: { startsWith: PREFIX } },
    });
    await prisma.notification.deleteMany({
      where: { dedupeKey: { startsWith: PREFIX } },
    });
    if (fx) {
      await updateSetting({
        key: "notifications",
        value: settings,
        actorEmployeeId: fx.manager.employeeId,
      });
      await cleanupScopeSmokeFixture(prisma, fx);
    }
    await prisma.$disconnect();
  });

  // Case: 100 permanent failures + newer valid intent: second flush delivers valid.
  it("100 permanent failures + newer valid intent: second flush delivers valid", async () => {
    const base = Date.now() - 200_000;
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < 100; i++) {
      await prisma.cleaningNotificationOutbox.create({
        data: {
          commandId: `${PREFIX}bad_${String(i).padStart(3, "0")}`,
          payload: { broken: true },
          createdAt: new Date(base + i),
        },
      });
    }
    const goodKey = `${PREFIX}good`;
    const dedupeKey = `${PREFIX}dedupe_good`;
    await prisma.cleaningNotificationOutbox.create({
      data: {
        commandId: goodKey,
        createdAt: new Date(base + 150),
        payload: {
          type: "cleaning.inspection_needed",
          title: "Inspection",
          // Configure body for the request/server under test.
          body: "Room ready",
          entityType: "cleaning_task",
          entityId: fx.taskAId,
          locationId: fx.locAId,
          actorEmployeeId: fx.manager.employeeId,
          recipientEmployeeIds: [fx.supervisorB.employeeId],
          dedupeKey,
          payload: { panel: "rooms" },
        },
      },
    });

    const first = await flushCleaningNotificationOutbox();
    assert.equal(first.delivered, 0);
    assert.equal(first.batchFailures, 100);
    assert.ok(first.quarantined >= 100);
    assert.ok(first.backlog >= 101);
    // Valid row was outside the first eligible batch of 100 permanent rows.
    assert.equal(
      (
        await prisma.cleaningNotificationOutbox.findUniqueOrThrow({
          where: { commandId: goodKey },
        })
      ).deliveredAt,
      null,
    );

    const second = await flushCleaningNotificationOutbox();
    assert.ok(second.delivered >= 1);
    assert.equal(second.pending, 0);
    const good = await prisma.cleaningNotificationOutbox.findUniqueOrThrow({
      where: { commandId: goodKey },
    });
    assert.ok(good.deliveredAt);
    const notices = await prisma.notification.findMany({
      where: { dedupeKey },
    });
    assert.equal(notices.length, 1);
    // Quarantined rows remain in backlog, not reported as pending=0 overall.
    assert.ok(second.backlog >= 100);
    assert.ok(second.quarantined >= 100);
  });

  // Case: transient failure schedules retry then delivers.
  it("transient failure schedules retry then delivers", async () => {
    const key = `${PREFIX}transient`;
    const dedupeKey = `${PREFIX}dedupe_transient`;
    await prisma.cleaningNotificationOutbox.create({
      data: {
        commandId: key,
        payload: {
          type: "cleaning.inspection_needed",
          title: "Inspection",
          // Configure body for the request/server under test.
          body: "Transient",
          entityType: "cleaning_task",
          entityId: fx.taskAId,
          locationId: fx.locAId,
          actorEmployeeId: fx.manager.employeeId,
          recipientEmployeeIds: [fx.supervisorB.employeeId],
          dedupeKey,
        },
      },
    });

    const name = `outbox_transient_${randomUUID().replaceAll("-", "")}`;
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."dedupeKey" = '${dedupeKey}' THEN RAISE EXCEPTION 'outbox_transient_test'; END IF; RETURN NEW; END $$`,
    );
    try {
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER ${name} BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
      try {
        const failed = await flushCleaningNotificationOutbox();
        assert.equal(failed.delivered, 0);
        assert.ok(failed.batchFailures >= 1);
        const row = await prisma.cleaningNotificationOutbox.findUniqueOrThrow({
          where: { commandId: key },
        });
        assert.equal(row.deliveredAt, null);
        assert.equal(row.failedPermanentlyAt, null);
        assert.ok(row.nextAttemptAt);
        assert.ok(row.attemptCount >= 1);
        // Make due immediately.
        await prisma.cleaningNotificationOutbox.update({
          where: { commandId: key },
          data: { nextAttemptAt: new Date(Date.now() - 1000) },
        });
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON "Notification"`);
      }
    } finally {
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
    }

    const ok = await flushCleaningNotificationOutbox();
    assert.ok(ok.delivered >= 1);
    assert.equal(
      (
        await prisma.cleaningNotificationOutbox.findUniqueOrThrow({
          where: { commandId: key },
        })
      ).deliveredAt != null,
      true,
    );
  });

  // Case probes concurrency/isolation: concurrent flush does not duplicate notifications for one intent.
  it("concurrent flush does not duplicate notifications for one intent", async () => {
    const key = `${PREFIX}concurrent`;
    const dedupeKey = `${PREFIX}dedupe_concurrent`;
    await prisma.cleaningNotificationOutbox.create({
      data: {
        commandId: key,
        payload: {
          type: "cleaning.inspection_needed",
          title: "Inspection",
          // Configure body for the request/server under test.
          body: "Concurrent",
          entityType: "cleaning_task",
          entityId: fx.taskAId,
          locationId: fx.locAId,
          actorEmployeeId: fx.manager.employeeId,
          recipientEmployeeIds: [fx.supervisorB.employeeId],
          dedupeKey,
        },
      },
    });
    // Run actors together to expose races and serialization bugs.
    await Promise.all([
      flushCleaningNotificationOutbox(),
      flushCleaningNotificationOutbox(),
      flushCleaningNotificationOutbox(),
    ]);
    assert.equal(
      await prisma.notification.count({ where: { dedupeKey } }),
      1,
    );
  });

  // Case: disabled in-app notifications mark intents delivered without rows.
  it("disabled in-app notifications mark intents delivered without rows", async () => {
    await updateSetting({
      key: "notifications",
      value: {
        ...settings,
        in_app: { ...settings.in_app, enabled: false },
      },
      actorEmployeeId: fx.manager.employeeId,
    });
    try {
      const key = `${PREFIX}disabled`;
      const dedupeKey = `${PREFIX}dedupe_disabled`;
      await prisma.cleaningNotificationOutbox.create({
        data: {
          commandId: key,
          payload: {
            type: "cleaning.inspection_needed",
            title: "Inspection",
            // Configure body for the request/server under test.
            body: "Disabled",
            entityType: "cleaning_task",
            entityId: fx.taskAId,
            recipientEmployeeIds: [fx.supervisorB.employeeId],
            dedupeKey,
          },
        },
      });
      const flushed = await flushCleaningNotificationOutbox();
      assert.ok(flushed.delivered >= 1);
      assert.ok(
        (
          await prisma.cleaningNotificationOutbox.findUniqueOrThrow({
            where: { commandId: key },
          })
        ).deliveredAt,
      );
      assert.equal(await prisma.notification.count({ where: { dedupeKey } }), 0);
    } finally {
      await updateSetting({
        key: "notifications",
        value: {
          ...settings,
          in_app: { ...settings.in_app, enabled: true },
        },
        actorEmployeeId: fx.manager.employeeId,
      });
    }
  });
});
