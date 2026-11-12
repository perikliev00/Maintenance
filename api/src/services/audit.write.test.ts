// Strict assert helpers for precise test failures.
import assert from "node:assert/strict";
// Node test runner (describe/it/hooks).
import { after, describe, it } from "node:test";
// Prisma client enums and input types.
import { Prisma, PrismaClient, Role } from "@prisma/client";
// Module import required below.
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
// Support the surrounding control flow.
} from "../../tests/fixtures";
// Runtime import from ./audit.
import { recordAudit, recordAuditMany } from "./audit";

// Local prisma used below.
const prisma = new PrismaClient();

// Test suite: recordAudit / recordAuditMany write contract.
describe("recordAudit / recordAuditMany write contract", () => {
  // Accumulator list fixtureIds.
  const fixtureIds: string[] = [];
  // Accumulator list auditIds.
  const auditIds: string[] = [];

  // Tear down after cases.
  after(async () => {
    // Threshold/size gate.
    if (auditIds.length) {
      // Delete obsolete row(s).
      await prisma.auditEvent.deleteMany({ where: { id: { in: auditIds } } });
    }
    // Await side effect before continuing.
    await cleanupEmployeeGraph(prisma, fixtureIds);
    // Prisma side effect for this step.
    await prisma.$disconnect();
  });

  // Test case: maps undefined/null/trim/occurredAt and empty many; rolls back with tx.
  it("maps undefined/null/trim/occurredAt and empty many; rolls back with tx", async () => {
    // Local stamp used below.
    const stamp = Date.now();
    // Await actor before dependent work.
    const actor = await createEmployeeWithUser(prisma, {
      // Set employeeNumber.
      employeeNumber: `T12-AUD-${stamp}`,
      // Set email.
      email: `t12-audit-${stamp}@test.local`,
      // Set role.
      role: Role.manager,
      // Set fullName.
      fullName: "T12 Audit Actor",
    });
    // Support the surrounding control flow.
    fixtureIds.push(actor.employeeId);

    // Date occurredAt for window math.
    const occurredAt = new Date("2026-01-15T12:34:56.000Z");
    // Await row before dependent work.
    const row = await recordAudit({
      // Set actorEmployeeId.
      actorEmployeeId: actor.employeeId,
      // Set action.
      action: "t12.write",
      // Set entityType.
      entityType: "Test",
      // Set entityId.
      entityId: `entity-${stamp}`,
      // Set reason.
      reason: "  padded reason  ",
      // Set summary.
      summary: "  padded summary  ",
      // Set before.
      before: undefined,
      // Set after.
      after: null,
      occurredAt,
    });
    // Support the surrounding control flow.
    auditIds.push(row.id);

    // Compare scalar values.
    assert.equal(row.reason, "padded reason");
    // Compare scalar values.
    assert.equal(row.summary, "padded summary");
    // Compare scalar values.
    assert.equal(row.occurredAt.toISOString(), occurredAt.toISOString());
    // Compare scalar values.
    assert.equal(row.before, null);
    // Prisma JsonNull stores as DB NULL
    assert.equal(row.after, null);

    // Await empty before dependent work.
    const empty = await recordAuditMany([]);
    // Compare scalar values.
    assert.equal(empty.count, 0);

    // Local marker used below.
    const marker = `t12-rollback-${stamp}`;
    // Await side effect before continuing.
    await assert.rejects(
      // Support the surrounding control flow.
      () =>
        // Database access for this step.
        prisma.$transaction(async (tx) => {
          // Await side effect before continuing.
          await recordAudit(
            // Support the surrounding control flow.
            {
              // Set actorEmployeeId.
              actorEmployeeId: actor.employeeId,
              // Set action.
              action: marker,
              // Set entityType.
              entityType: "Test",
              // Set entityId.
              entityId: `rollback-${stamp}`,
              // Set reason.
              reason: "must roll back",
            },
            tx,
          );
          // Abort with an error.
          throw new Error("force rollback after audit");
        }),
      // Support the surrounding control flow.
      /force rollback after audit/,
    );

    // Count rows into leaked.
    const leaked = await prisma.auditEvent.count({
      // Filter matching rows.
      where: { action: marker },
    });
    // Compare scalar values.
    assert.equal(leaked, 0, "audit inside failed tx must roll back");

    // JsonNull path via createMany
    const many = await recordAuditMany([
      // Support the surrounding control flow.
      {
        // Set actorEmployeeId.
        actorEmployeeId: actor.employeeId,
        // Set action.
        action: "t12.many",
        // Set entityType.
        entityType: "Test",
        // Set entityId.
        entityId: `many-${stamp}`,
        // Set before.
        before: null,
        // Set after.
        after: { ok: true },
      },
    ]);
    // Compare scalar values.
    assert.equal(many.count, 1);
    // Fetch manyRow by unique/first match.
    const manyRow = await prisma.auditEvent.findFirstOrThrow({
      // Filter matching rows.
      where: { action: "t12.many", entityId: `many-${stamp}` },
    });
    // Support the surrounding control flow.
    auditIds.push(manyRow.id);
    // Compare scalar values.
    assert.equal(manyRow.before, null);
    // Deep-compare structures.
    assert.deepEqual(manyRow.after, { ok: true });

    // Satisfy Prisma JsonNull type usage in mapping (compile-time contract)
    assert.equal(Prisma.JsonNull.toString(), "Prisma.JsonNull");
  });
});
