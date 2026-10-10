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
      employeeNumber: `T12-AUD-${stamp}`,
      email: `t12-audit-${stamp}@test.local`,
      role: Role.manager,
      fullName: "T12 Audit Actor",
    });
    fixtureIds.push(actor.employeeId);

    const occurredAt = new Date("2026-01-15T12:34:56.000Z");
    const row = await recordAudit({
      actorEmployeeId: actor.employeeId,
      action: "t12.write",
      entityType: "Test",
      entityId: `entity-${stamp}`,
      reason: "  padded reason  ",
      summary: "  padded summary  ",
      before: undefined,
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
        prisma.$transaction(async (tx) => {
          await recordAudit(
            {
              actorEmployeeId: actor.employeeId,
              action: marker,
              entityType: "Test",
              entityId: `rollback-${stamp}`,
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
        actorEmployeeId: actor.employeeId,
        action: "t12.many",
        entityType: "Test",
        entityId: `many-${stamp}`,
        before: null,
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
