import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { CardStatus, CardType, PrismaClient, Role } from "@prisma/client";
import { listCards } from "./cards";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  ensureUnrelatedControlFixture,
  UNRELATED_CONTROL_EMAIL,
} from "../../tests/fixtures";

const prisma = new PrismaClient();

describe("listCards staffOnly AND filters", () => {
  const fixtureEmployeeIds: string[] = [];

  after(async () => {
    await cleanupEmployeeGraph(prisma, fixtureEmployeeIds);
    await prisma.$disconnect();
  });

  it("intersects staffOnly with employeeId and cardType", async () => {
    const control = await ensureUnrelatedControlFixture(prisma);
    const unique = Date.now();
    const empA = await createEmployeeWithUser(prisma, {
      employeeNumber: `T03-CARD-A-${unique}`,
      email: `t03-card-a-${unique}@test.local`,
      role: Role.reception,
      fullName: "T03 Card Emp A",
    });
    const empB = await createEmployeeWithUser(prisma, {
      employeeNumber: `T03-CARD-B-${unique}`,
      email: `t03-card-b-${unique}@test.local`,
      role: Role.reception,
      fullName: "T03 Card Emp B",
    });
    fixtureEmployeeIds.push(empA.employeeId, empB.employeeId);

    const issuerId = empA.employeeId;
    const cardA = await prisma.accessCard.create({
      data: {
        cardType: CardType.housekeeper,
        status: CardStatus.active,
        label: `filter-a-${unique}`,
        employeeId: empA.employeeId,
        issuedByEmployeeId: issuerId,
        commandId: `cmd-a-${unique}`,
      },
    });
    const cardB = await prisma.accessCard.create({
      data: {
        cardType: CardType.maintenance,
        status: CardStatus.active,
        label: `filter-b-${unique}`,
        employeeId: empB.employeeId,
        issuedByEmployeeId: issuerId,
        commandId: `cmd-b-${unique}`,
      },
    });
    const guest = await prisma.accessCard.create({
      data: {
        cardType: CardType.guest,
        status: CardStatus.active,
        label: `filter-guest-${unique}`,
        issuedByEmployeeId: issuerId,
        commandId: `cmd-guest-${unique}`,
      },
    });

    try {
      const combined = await listCards({
        staffOnly: true,
        employeeId: empA.employeeId,
        cardType: CardType.housekeeper,
      });
      const ids = combined.map((c) => c.id);
      assert.ok(ids.includes(cardA.id), "includes matching housekeeper card A");
      assert.ok(!ids.includes(cardB.id), "excludes maintenance card B");
      assert.ok(!ids.includes(guest.id), "excludes guest");

      const staffOnly = await listCards({ staffOnly: true });
      const staffIds = staffOnly.map((c) => c.id);
      assert.ok(staffIds.includes(cardA.id));
      assert.ok(staffIds.includes(cardB.id));
      assert.ok(!staffIds.includes(guest.id));

      const byEmployee = await listCards({ employeeId: empB.employeeId });
      assert.ok(byEmployee.some((c) => c.id === cardB.id));
      assert.ok(!byEmployee.some((c) => c.id === cardA.id));

      const incompatible = await listCards({
        staffOnly: true,
        cardType: CardType.guest,
      });
      assert.equal(
        incompatible.length,
        0,
        "staffOnly + guest must not widen results",
      );

      const withStatus = await listCards({
        staffOnly: true,
        employeeId: empA.employeeId,
        status: CardStatus.revoked,
      });
      assert.ok(!withStatus.some((c) => c.id === cardA.id));

      const withSearch = await listCards({
        staffOnly: true,
        q: `filter-a-${unique}`,
      });
      assert.ok(withSearch.some((c) => c.id === cardA.id));
      assert.ok(!withSearch.some((c) => c.id === cardB.id));

      const controlStill = await prisma.user.findUnique({
        where: { email: UNRELATED_CONTROL_EMAIL },
      });
      assert.ok(controlStill, "unrelated control fixture must remain");
      assert.equal(controlStill.employeeId, control.employeeId);
    } finally {
      await prisma.accessCard.deleteMany({
        where: { id: { in: [cardA.id, cardB.id, guest.id] } },
      });
    }
  });
});
