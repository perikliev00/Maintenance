import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CardStatus, CardType, PrismaClient } from "@prisma/client";
import { listCards } from "./cards";

const prisma = new PrismaClient();

describe("listCards staffOnly AND filters", () => {
  it("intersects staffOnly with employeeId and cardType", async () => {
    const employees = await prisma.employee.findMany({
      where: { user: { isActive: true } },
      take: 2,
      orderBy: { employeeNumber: "asc" },
    });
    assert.ok(employees.length >= 2, "need two employees");
    const [empA, empB] = employees;

    const issuer = empA;
    const unique = Date.now();
    const cardA = await prisma.accessCard.create({
      data: {
        cardType: CardType.housekeeper,
        status: CardStatus.active,
        label: `filter-a-${unique}`,
        employeeId: empA.id,
        issuedByEmployeeId: issuer.id,
        commandId: `cmd-a-${unique}`,
      },
    });
    const cardB = await prisma.accessCard.create({
      data: {
        cardType: CardType.maintenance,
        status: CardStatus.active,
        label: `filter-b-${unique}`,
        employeeId: empB.id,
        issuedByEmployeeId: issuer.id,
        commandId: `cmd-b-${unique}`,
      },
    });
    const guest = await prisma.accessCard.create({
      data: {
        cardType: CardType.guest,
        status: CardStatus.active,
        label: `filter-guest-${unique}`,
        issuedByEmployeeId: issuer.id,
        commandId: `cmd-guest-${unique}`,
      },
    });

    try {
      const combined = await listCards({
        staffOnly: true,
        employeeId: empA.id,
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

      const byEmployee = await listCards({ employeeId: empB.id });
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
        employeeId: empA.id,
        status: CardStatus.revoked,
      });
      assert.ok(!withStatus.some((c) => c.id === cardA.id));

      const withSearch = await listCards({
        staffOnly: true,
        q: `filter-a-${unique}`,
      });
      assert.ok(withSearch.some((c) => c.id === cardA.id));
      assert.ok(!withSearch.some((c) => c.id === cardB.id));
    } finally {
      await prisma.accessCard.deleteMany({
        where: { id: { in: [cardA.id, cardB.id, guest.id] } },
      });
    }
  });
});
