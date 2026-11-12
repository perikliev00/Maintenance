import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { Prisma, PrismaClient, Role } from "@prisma/client";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
} from "../../tests/fixtures";
import { recordAudit, recordAuditMany } from "./audit";

const prisma = new PrismaClient();

describe("recordAudit / recordAuditMany write contract", () => {
  const fixtureIds: string[] = [];
  const auditIds: string[] = [];

  after(async () => {
    if (auditIds.length) {
      await prisma.auditEvent.deleteMany({ where: { id: { in: auditIds } } });
    }
    await cleanupEmployeeGraph(prisma, fixtureIds);
    await prisma.$disconnect();
  });

  it("maps undefined/null/trim/occurredAt and empty many; rolls back with tx", async () => {
    const stamp = Date.now();
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
    fixtureIds.push(actor.employeeId);

    const occurredAt = new Date("2026-01-15T12:34:56.000Z");
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
    auditIds.push(row.id);

    assert.equal(row.reason, "padded reason");
    assert.equal(row.summary, "padded summary");
    assert.equal(row.occurredAt.toISOString(), occurredAt.toISOString());
    assert.equal(row.before, null);
    // Prisma JsonNull stores as DB NULL
    assert.equal(row.after, null);

    const empty = await recordAuditMany([]);
    assert.equal(empty.count, 0);

    const marker = `t12-rollback-${stamp}`;
    await assert.rejects(
      () =>
        // Database access for this step.
        prisma.$transaction(async (tx) => {
          await recordAudit(
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
          throw new Error("force rollback after audit");
        }),
      /force rollback after audit/,
    );

    const leaked = await prisma.auditEvent.count({
      where: { action: marker },
    });
    assert.equal(leaked, 0, "audit inside failed tx must roll back");

    // JsonNull path via createMany
    const many = await recordAuditMany([
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
    assert.equal(many.count, 1);
    const manyRow = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "t12.many", entityId: `many-${stamp}` },
    });
    auditIds.push(manyRow.id);
    assert.equal(manyRow.before, null);
    assert.deepEqual(manyRow.after, { ok: true });

    // Satisfy Prisma JsonNull type usage in mapping (compile-time contract)
    assert.equal(Prisma.JsonNull.toString(), "Prisma.JsonNull");
  });
});
