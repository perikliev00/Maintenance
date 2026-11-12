/**
 * CODE-06: permanent failures must not starve newer valid outbox intents.
 * Uses CleaningNotificationOutbox (no TicketEvent FK) for disposable rows.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import bindings from ../../src/services/cleaning/notificationOutbox.
import { flushCleaningNotificationOutbox } from "../../src/services/cleaning/notificationOutbox";
// Import bindings from ../../src/services/settings.
import { getSetting, updateSetting } from "../../src/services/settings";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  createScopeSmokeFixture,
  // Execute the next setup or assertion step for this scenario.
  cleanupScopeSmokeFixture,
  // Shape ScopeSmokeFixture documents the fixture/response fields this suite touches.
  type ScopeSmokeFixture,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../fixtures";

// PREFIX: unique stamp so parallel runs do not collide.
const PREFIX = `starve_${randomUUID().slice(0, 8)}_`;

// Suite: notification outbox starvation / retry.
describe("notification outbox starvation / retry", () => {
  // Execute the next setup or assertion step for this scenario.
  let fx: ScopeSmokeFixture;
  // Delivery/replay step for async notification paths.
  let settings: Awaited<ReturnType<typeof getSetting<"notifications">>>;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fx = await createScopeSmokeFixture(prisma);
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
      actorEmployeeId: fx.manager.employeeId,
    });
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Await async work before asserting or releasing locks.
    await prisma.cleaningNotificationOutbox.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { commandId: { startsWith: PREFIX } },
    });
    // Await async work before asserting or releasing locks.
    await prisma.notification.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { dedupeKey: { startsWith: PREFIX } },
    });
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (fx) {
      // Await async work before asserting or releasing locks.
      await updateSetting({
        // Delivery/replay step for async notification paths.
        key: "notifications",
        // Execute the next setup or assertion step for this scenario.
        value: settings,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: fx.manager.employeeId,
      });
      // Await async work before asserting or releasing locks.
      await cleanupScopeSmokeFixture(prisma, fx);
    }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: 100 permanent failures + newer valid intent: second flush delivers valid.
  it("100 permanent failures + newer valid intent: second flush delivers valid", async () => {
    // Bind base for later setup or assertions in this scope.
    const base = Date.now() - 200_000;
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < 100; i++) {
      // Await async work before asserting or releasing locks.
      await prisma.cleaningNotificationOutbox.create({
        // Execute the next setup or assertion step for this scenario.
        data: {
          // Execute the next setup or assertion step for this scenario.
          commandId: `${PREFIX}bad_${String(i).padStart(3, "0")}`,
          // Execute the next setup or assertion step for this scenario.
          payload: { broken: true },
          // Execute the next setup or assertion step for this scenario.
          createdAt: new Date(base + i),
        },
      });
    }
    // Bind goodKey for later setup or assertions in this scope.
    const goodKey = `${PREFIX}good`;
    // Bind dedupeKey for later setup or assertions in this scope.
    const dedupeKey = `${PREFIX}dedupe_good`;
    // Await async work before asserting or releasing locks.
    await prisma.cleaningNotificationOutbox.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        commandId: goodKey,
        // Execute the next setup or assertion step for this scenario.
        createdAt: new Date(base + 150),
        // Execute the next setup or assertion step for this scenario.
        payload: {
          // Execute the next setup or assertion step for this scenario.
          type: "cleaning.inspection_needed",
          // Execute the next setup or assertion step for this scenario.
          title: "Inspection",
          // Configure body for the request/server under test.
          body: "Room ready",
          // Execute the next setup or assertion step for this scenario.
          entityType: "cleaning_task",
          // Execute the next setup or assertion step for this scenario.
          entityId: fx.taskAId,
          // Execute the next setup or assertion step for this scenario.
          locationId: fx.locAId,
          // Execute the next setup or assertion step for this scenario.
          actorEmployeeId: fx.manager.employeeId,
          // Execute the next setup or assertion step for this scenario.
          recipientEmployeeIds: [fx.supervisorB.employeeId],
          // Execute the next setup or assertion step for this scenario.
          dedupeKey,
          // Execute the next setup or assertion step for this scenario.
          payload: { panel: "rooms" },
        },
      },
    });

    // first: synchronize actors so the race window is observable.
    const first = await flushCleaningNotificationOutbox();
    // Assert the observed value matches the intended post-condition.
    assert.equal(first.delivered, 0);
    // Assert the observed value matches the intended post-condition.
    assert.equal(first.batchFailures, 100);
    // Assert the observed value matches the intended post-condition.
    assert.ok(first.quarantined >= 100);
    // Assert the observed value matches the intended post-condition.
    assert.ok(first.backlog >= 101);
    // Valid row was outside the first eligible batch of 100 permanent rows.
    assert.equal(
      (
        // Await async work before asserting or releasing locks.
        await prisma.cleaningNotificationOutbox.findUniqueOrThrow({
          // SQL fragment used to observe locks or assert DB state.
          where: { commandId: goodKey },
        })
      // Execute the next setup or assertion step for this scenario.
      ).deliveredAt,
      // Execute the next setup or assertion step for this scenario.
      null,
    );

    // second: synchronize actors so the race window is observable.
    const second = await flushCleaningNotificationOutbox();
    // Assert the observed value matches the intended post-condition.
    assert.ok(second.delivered >= 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(second.pending, 0);
    // good: synchronize actors so the race window is observable.
    const good = await prisma.cleaningNotificationOutbox.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { commandId: goodKey },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(good.deliveredAt);
    // notices: synchronize actors so the race window is observable.
    const notices = await prisma.notification.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { dedupeKey },
    });
    // Assert collection size matches the expected post-condition.
    assert.equal(notices.length, 1);
    // Quarantined rows remain in backlog, not reported as pending=0 overall.
    assert.ok(second.backlog >= 100);
    // Assert the observed value matches the intended post-condition.
    assert.ok(second.quarantined >= 100);
  });

  // Case: transient failure schedules retry then delivers.
  it("transient failure schedules retry then delivers", async () => {
    // Bind key for later setup or assertions in this scope.
    const key = `${PREFIX}transient`;
    // Bind dedupeKey for later setup or assertions in this scope.
    const dedupeKey = `${PREFIX}dedupe_transient`;
    // Await async work before asserting or releasing locks.
    await prisma.cleaningNotificationOutbox.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        commandId: key,
        // Execute the next setup or assertion step for this scenario.
        payload: {
          // Execute the next setup or assertion step for this scenario.
          type: "cleaning.inspection_needed",
          // Execute the next setup or assertion step for this scenario.
          title: "Inspection",
          // Configure body for the request/server under test.
          body: "Transient",
          // Execute the next setup or assertion step for this scenario.
          entityType: "cleaning_task",
          // Execute the next setup or assertion step for this scenario.
          entityId: fx.taskAId,
          // Execute the next setup or assertion step for this scenario.
          locationId: fx.locAId,
          // Execute the next setup or assertion step for this scenario.
          actorEmployeeId: fx.manager.employeeId,
          // Execute the next setup or assertion step for this scenario.
          recipientEmployeeIds: [fx.supervisorB.employeeId],
          // Execute the next setup or assertion step for this scenario.
          dedupeKey,
        },
      },
    });

    // name: unique stamp so parallel runs do not collide.
    const name = `outbox_transient_${randomUUID().replaceAll("-", "")}`;
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(
      // Delivery/replay step for async notification paths.
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."dedupeKey" = '${dedupeKey}' THEN RAISE EXCEPTION 'outbox_transient_test'; END IF; RETURN NEW; END $$`,
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
        // failed: synchronize actors so the race window is observable.
        const failed = await flushCleaningNotificationOutbox();
        // Assert the observed value matches the intended post-condition.
        assert.equal(failed.delivered, 0);
        // Assert the observed value matches the intended post-condition.
        assert.ok(failed.batchFailures >= 1);
        // row: synchronize actors so the race window is observable.
        const row = await prisma.cleaningNotificationOutbox.findUniqueOrThrow({
          // SQL fragment used to observe locks or assert DB state.
          where: { commandId: key },
        });
        // Assert the observed value matches the intended post-condition.
        assert.equal(row.deliveredAt, null);
        // Assert the observed value matches the intended post-condition.
        assert.equal(row.failedPermanentlyAt, null);
        // Assert the observed value matches the intended post-condition.
        assert.ok(row.nextAttemptAt);
        // Assert the observed value matches the intended post-condition.
        assert.ok(row.attemptCount >= 1);
        // Make due immediately.
        await prisma.cleaningNotificationOutbox.update({
          // SQL fragment used to observe locks or assert DB state.
          where: { commandId: key },
          // Execute the next setup or assertion step for this scenario.
          data: { nextAttemptAt: new Date(Date.now() - 1000) },
        });
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

    // ok: synchronize actors so the race window is observable.
    const ok = await flushCleaningNotificationOutbox();
    // Assert the observed value matches the intended post-condition.
    assert.ok(ok.delivered >= 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      (
        // Await async work before asserting or releasing locks.
        await prisma.cleaningNotificationOutbox.findUniqueOrThrow({
          // SQL fragment used to observe locks or assert DB state.
          where: { commandId: key },
        })
      // Execute the next setup or assertion step for this scenario.
      ).deliveredAt != null,
      // Execute the next setup or assertion step for this scenario.
      true,
    );
  });

  // Case probes concurrency/isolation: concurrent flush does not duplicate notifications for one intent.
  it("concurrent flush does not duplicate notifications for one intent", async () => {
    // Bind key for later setup or assertions in this scope.
    const key = `${PREFIX}concurrent`;
    // Bind dedupeKey for later setup or assertions in this scope.
    const dedupeKey = `${PREFIX}dedupe_concurrent`;
    // Await async work before asserting or releasing locks.
    await prisma.cleaningNotificationOutbox.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        commandId: key,
        // Execute the next setup or assertion step for this scenario.
        payload: {
          // Execute the next setup or assertion step for this scenario.
          type: "cleaning.inspection_needed",
          // Execute the next setup or assertion step for this scenario.
          title: "Inspection",
          // Configure body for the request/server under test.
          body: "Concurrent",
          // Execute the next setup or assertion step for this scenario.
          entityType: "cleaning_task",
          // Execute the next setup or assertion step for this scenario.
          entityId: fx.taskAId,
          // Execute the next setup or assertion step for this scenario.
          locationId: fx.locAId,
          // Execute the next setup or assertion step for this scenario.
          actorEmployeeId: fx.manager.employeeId,
          // Execute the next setup or assertion step for this scenario.
          recipientEmployeeIds: [fx.supervisorB.employeeId],
          // Execute the next setup or assertion step for this scenario.
          dedupeKey,
        },
      },
    });
    // Run actors together to expose races and serialization bugs.
    await Promise.all([
      // Delivery/replay step for async notification paths.
      flushCleaningNotificationOutbox(),
      // Delivery/replay step for async notification paths.
      flushCleaningNotificationOutbox(),
      // Delivery/replay step for async notification paths.
      flushCleaningNotificationOutbox(),
    ]);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.notification.count({ where: { dedupeKey } }),
      1,
    );
  });

  // Case: disabled in-app notifications mark intents delivered without rows.
  it("disabled in-app notifications mark intents delivered without rows", async () => {
    // Await async work before asserting or releasing locks.
    await updateSetting({
      // Delivery/replay step for async notification paths.
      key: "notifications",
      // Execute the next setup or assertion step for this scenario.
      value: {
        // Continue the call chain for setup or assertion detail.
        ...settings,
        // Execute the next setup or assertion step for this scenario.
        in_app: { ...settings.in_app, enabled: false },
      },
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: fx.manager.employeeId,
    });
    // Try path where partial failure must not leak suite state.
    try {
      // Bind key for later setup or assertions in this scope.
      const key = `${PREFIX}disabled`;
      // Bind dedupeKey for later setup or assertions in this scope.
      const dedupeKey = `${PREFIX}dedupe_disabled`;
      // Await async work before asserting or releasing locks.
      await prisma.cleaningNotificationOutbox.create({
        // Execute the next setup or assertion step for this scenario.
        data: {
          // Execute the next setup or assertion step for this scenario.
          commandId: key,
          // Execute the next setup or assertion step for this scenario.
          payload: {
            // Execute the next setup or assertion step for this scenario.
            type: "cleaning.inspection_needed",
            // Execute the next setup or assertion step for this scenario.
            title: "Inspection",
            // Configure body for the request/server under test.
            body: "Disabled",
            // Execute the next setup or assertion step for this scenario.
            entityType: "cleaning_task",
            // Execute the next setup or assertion step for this scenario.
            entityId: fx.taskAId,
            // Execute the next setup or assertion step for this scenario.
            recipientEmployeeIds: [fx.supervisorB.employeeId],
            // Execute the next setup or assertion step for this scenario.
            dedupeKey,
          },
        },
      });
      // flushed: synchronize actors so the race window is observable.
      const flushed = await flushCleaningNotificationOutbox();
      // Assert the observed value matches the intended post-condition.
      assert.ok(flushed.delivered >= 1);
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        (
          // Await async work before asserting or releasing locks.
          await prisma.cleaningNotificationOutbox.findUniqueOrThrow({
            // SQL fragment used to observe locks or assert DB state.
            where: { commandId: key },
          })
        // Execute the next setup or assertion step for this scenario.
        ).deliveredAt,
      );
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.notification.count({ where: { dedupeKey } }), 0);
    // Execute the next setup or assertion step for this scenario.
    } finally {
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
        actorEmployeeId: fx.manager.employeeId,
      });
    }
  });
});
