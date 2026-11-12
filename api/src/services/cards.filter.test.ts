// Strict assert helpers for precise test failures.
import assert from "node:assert/strict";
// Node test runner (describe/it/hooks).
import { after, describe, it } from "node:test";
// Prisma client enums and input types.
import { CardStatus, CardType, PrismaClient, Role } from "@prisma/client";
// Runtime import from ./cards.
import { listCards } from "./cards";
// Module import required below.
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  ensureUnrelatedControlFixture,
  UNRELATED_CONTROL_EMAIL,
// Support the surrounding control flow.
} from "../../tests/fixtures";

// Local prisma used below.
const prisma = new PrismaClient();

// Test suite: listCards staffOnly AND filters.
describe("listCards staffOnly AND filters", () => {
  // Accumulator list fixtureEmployeeIds.
  const fixtureEmployeeIds: string[] = [];

  // Tear down after cases.
  after(async () => {
    // Await side effect before continuing.
    await cleanupEmployeeGraph(prisma, fixtureEmployeeIds);
    // Prisma side effect for this step.
    await prisma.$disconnect();
  });

  // Test case: intersects staffOnly with employeeId and cardType.
  it("intersects staffOnly with employeeId and cardType", async () => {
    // Await control before dependent work.
    const control = await ensureUnrelatedControlFixture(prisma);
    // Local unique used below.
    const unique = Date.now();
    // Await empA before dependent work.
    const empA = await createEmployeeWithUser(prisma, {
      // Set employeeNumber.
      employeeNumber: `T03-CARD-A-${unique}`,
      // Set email.
      email: `t03-card-a-${unique}@test.local`,
      // Set role.
      role: Role.reception,
      // Set fullName.
      fullName: "T03 Card Emp A",
    });
    // Await empB before dependent work.
    const empB = await createEmployeeWithUser(prisma, {
      // Set employeeNumber.
      employeeNumber: `T03-CARD-B-${unique}`,
      // Set email.
      email: `t03-card-b-${unique}@test.local`,
      // Set role.
      role: Role.reception,
      // Set fullName.
      fullName: "T03 Card Emp B",
    });
    // Support the surrounding control flow.
    fixtureEmployeeIds.push(empA.employeeId, empB.employeeId);

    // Local issuerId used below.
    const issuerId = empA.employeeId;
    // Create row and keep as cardA.
    const cardA = await prisma.accessCard.create({
      // Mutation data payload.
      data: {
        // Field cardType on this type/payload.
        cardType: CardType.housekeeper,
        // Field status on this type/payload.
        status: CardStatus.active,
        // Field label on this type/payload.
        label: `filter-a-${unique}`,
        // Field employeeId on this type/payload.
        employeeId: empA.employeeId,
        // Field issuedByEmployeeId on this type/payload.
        issuedByEmployeeId: issuerId,
        // Field commandId on this type/payload.
        commandId: `cmd-a-${unique}`,
      },
    });
    // Create row and keep as cardB.
    const cardB = await prisma.accessCard.create({
      // Mutation data payload.
      data: {
        // Field cardType on this type/payload.
        cardType: CardType.maintenance,
        // Field status on this type/payload.
        status: CardStatus.active,
        // Field label on this type/payload.
        label: `filter-b-${unique}`,
        // Field employeeId on this type/payload.
        employeeId: empB.employeeId,
        // Field issuedByEmployeeId on this type/payload.
        issuedByEmployeeId: issuerId,
        // Field commandId on this type/payload.
        commandId: `cmd-b-${unique}`,
      },
    });
    // Create row and keep as guest.
    const guest = await prisma.accessCard.create({
      // Mutation data payload.
      data: {
        // Field cardType on this type/payload.
        cardType: CardType.guest,
        // Field status on this type/payload.
        status: CardStatus.active,
        // Field label on this type/payload.
        label: `filter-guest-${unique}`,
        // Field issuedByEmployeeId on this type/payload.
        issuedByEmployeeId: issuerId,
        // Field commandId on this type/payload.
        commandId: `cmd-guest-${unique}`,
      },
    });

    // Catch locally so callers get mapped errors.
    try {
      // Await combined before dependent work.
      const combined = await listCards({
        // Set staffOnly flag.
        staffOnly: true,
        // Set employeeId.
        employeeId: empA.employeeId,
        // Set cardType.
        cardType: CardType.housekeeper,
      });
      // ids: projected collection.
      const ids = combined.map((c) => c.id);
      // Require truthy condition.
      assert.ok(ids.includes(cardA.id), "includes matching housekeeper card A");
      // Require truthy condition.
      assert.ok(!ids.includes(cardB.id), "excludes maintenance card B");
      // Require truthy condition.
      assert.ok(!ids.includes(guest.id), "excludes guest");

      // Await staffOnly before dependent work.
      const staffOnly = await listCards({ staffOnly: true });
      // staffIds: projected collection.
      const staffIds = staffOnly.map((c) => c.id);
      // Require truthy condition.
      assert.ok(staffIds.includes(cardA.id));
      // Require truthy condition.
      assert.ok(staffIds.includes(cardB.id));
      // Require truthy condition.
      assert.ok(!staffIds.includes(guest.id));

      // Await byEmployee before dependent work.
      const byEmployee = await listCards({ employeeId: empB.employeeId });
      // Require truthy condition.
      assert.ok(byEmployee.some((c) => c.id === cardB.id));
      // Require truthy condition.
      assert.ok(!byEmployee.some((c) => c.id === cardA.id));

      // Await incompatible before dependent work.
      const incompatible = await listCards({
        // Set staffOnly flag.
        staffOnly: true,
        // Set cardType.
        cardType: CardType.guest,
      });
      // Compare scalar values.
      assert.equal(
        // Support the surrounding control flow.
        incompatible.length,
        0,
        "staffOnly + guest must not widen results",
      );

      // Await withStatus before dependent work.
      const withStatus = await listCards({
        // Set staffOnly flag.
        staffOnly: true,
        // Set employeeId.
        employeeId: empA.employeeId,
        // Set status.
        status: CardStatus.revoked,
      });
      // Require truthy condition.
      assert.ok(!withStatus.some((c) => c.id === cardA.id));

      // Await withSearch before dependent work.
      const withSearch = await listCards({
        // Set staffOnly flag.
        staffOnly: true,
        // Set q.
        q: `filter-a-${unique}`,
      });
      // Require truthy condition.
      assert.ok(withSearch.some((c) => c.id === cardA.id));
      // Require truthy condition.
      assert.ok(!withSearch.some((c) => c.id === cardB.id));

      // Fetch controlStill by unique/first match.
      const controlStill = await prisma.user.findUnique({
        // Filter matching rows.
        where: { email: UNRELATED_CONTROL_EMAIL },
      });
      // Require truthy condition.
      assert.ok(controlStill, "unrelated control fixture must remain");
      // Compare scalar values.
      assert.equal(controlStill.employeeId, control.employeeId);
    // Support the surrounding control flow.
    } finally {
      // Delete obsolete row(s).
      await prisma.accessCard.deleteMany({
        // Filter matching rows.
        where: { id: { in: [cardA.id, cardB.id, guest.id] } },
      });
    }
  });
});
