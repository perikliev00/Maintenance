/**
 * T-RDY-05 / P1-35 archive; T-RDY-06 / P1-36 common-area occupancy.
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import path from "node:path";
import {
  CleaningStatus,
  DailyPlanCategory,
  Occupancy,
  PrismaClient,
} from "@prisma/client";
import dotenv from "dotenv";
import { createCleaningTask } from "../../src/services/cleaning";
import { createDailyPlanEntry } from "../../src/services/dailyPlan";
import { archiveLocation } from "../../src/services/locations";
import { createMaintenanceTicket, listTicketEvents } from "../../src/services/maintenance";
import { isAppError } from "./fixtures";
import {
  CLN_PASSWORD,
  cleanupReadinessWorld,
  createReadinessWorld,
  findActiveIssueOption,
  getJson,
  getRoomViaApi,
  hotelTodayYmd,
  listenApp,
  closeServer,
  loginBearer,
  patchJson,
  prepareRoomBase,
  resetCleaningWork,
  type ReadinessWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

describe("readiness archive + occupancy (T-RDY-05/06 / P1-35/36)", () => {
  let world: ReadinessWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let ownerToken: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createReadinessWorld(prisma);
    ({ server, api } = await listenApp());
    const login = await loginBearer(api, world.owner.email, CLN_PASSWORD);
    ownerToken = login.token;
  });

  beforeEach(async () => {
    await resetCleaningWork(prisma, world);
    // Restore archived rooms from prior tests.
    await prisma.location.updateMany({
      where: {
        id: {
          in: [world.locationAId, world.locationBId, world.commonAreaId],
        },
      },
      data: { catalogStatus: "active" },
    });
    await prisma.ticketEvent.deleteMany({
      where: {
        ticket: {
          locationId: {
            in: [world.locationAId, world.locationBId, world.commonAreaId],
          },
        },
      },
    });
    await prisma.maintenanceTicket.deleteMany({
      where: {
        locationId: {
          in: [world.locationAId, world.locationBId, world.commonAreaId],
        },
      },
    });
    await prepareRoomBase(prisma, world.locationAId, CleaningStatus.dirty);
  });

  after(async () => {
    if (server) await closeServer(server);
    if (world) await cleanupReadinessWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("T-RDY-05: archived room drops from ops lists, rejects cleaning/plan, keeps history (P1-35)", async () => {
    const option = await findActiveIssueOption(prisma);
    const reported = await createMaintenanceTicket({
      locationId: world.locationAId,
      issueOptionId: option.id,
      blocksRoom: false,
      reportedByEmployeeId: world.owner.employeeId,
      commandId: randomUUID(),
    });
    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });
    assert.ok(task.id);

    await archiveLocation(world.locationAId, world.owner.employeeId);

    const roomsList = await getJson(api, ownerToken, "/rooms");
    assert.equal(roomsList.status, 200);
    const rooms = roomsList.body as { id: string }[] | { items?: { id: string }[] };
    const roomArr = Array.isArray(rooms)
      ? rooms
      : Array.isArray(rooms.items)
        ? rooms.items
        : [];
    assert.ok(
      !roomArr.some((r) => r.id === world.locationAId),
      "archived room must not appear in GET /rooms",
    );

    const single = await getRoomViaApi(api, ownerToken, world.locationAId);
    assert.ok(
      single.status === 404 || single.body.catalogStatus === "archived",
      `expected 404 or archived, got ${single.status}`,
    );

    try {
      await createCleaningTask({
        locationId: world.locationAId,
        hotelDate: today,
        assignedEmployeeId: world.hk1.employeeId,
        actorEmployeeId: world.owner.employeeId,
      });
      assert.fail("expected archived reject on createCleaningTask");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "invalid_state");
      assert.match(err.message, /archived/i);
    }

    try {
      await createDailyPlanEntry({
        hotelDate: today,
        locationId: world.locationAId,
        category: DailyPlanCategory.departure,
        createdByEmployeeId: world.owner.employeeId,
      });
      assert.fail("expected archived reject on createDailyPlanEntry");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "invalid_state");
      assert.match(err.message, /archived/i);
    }

    // History preserved: ticket + events still readable.
    const ticket = await prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: reported.ticket.id },
    });
    assert.equal(ticket.locationId, world.locationAId);
    const events = await listTicketEvents(reported.ticket.id);
    assert.ok(events.length >= 1);

    // Admin catalog may still show archived when requested.
    const catalog = await getJson(
      api,
      ownerToken,
      "/locations?includeArchived=true",
    );
    assert.equal(catalog.status, 200);
  });

  it("T-RDY-06: common-area occupancy rejected without state change (P1-36)", async () => {
    const before = await prisma.location.findUniqueOrThrow({
      where: { id: world.commonAreaId },
    });

    const denied = await patchJson(
      api,
      ownerToken,
      `/locations/${world.commonAreaId}/occupancy`,
      { occupancy: "occupied" },
    );
    assert.equal(denied.status, 400);
    const deniedBody = denied.body as {
      code?: string;
      error?: string;
      message?: string;
    };
    const code = deniedBody.code ?? deniedBody.error;
    assert.equal(code, "validation");
    assert.match(
      JSON.stringify(deniedBody),
      /occupancy|common/i,
    );

    const after = await prisma.location.findUniqueOrThrow({
      where: { id: world.commonAreaId },
    });
    assert.equal(after.occupancy, before.occupancy);

    // Positive control: same actor on a room succeeds.
    await prepareRoomBase(prisma, world.locationBId, CleaningStatus.dirty);
    const ok = await patchJson(
      api,
      ownerToken,
      `/locations/${world.locationBId}/occupancy`,
      { occupancy: "occupied" },
    );
    assert.equal(ok.status, 200);
    const room = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationBId },
    });
    assert.equal(room.occupancy, Occupancy.occupied);
  });
});
