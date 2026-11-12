/**
 * report validation (option XOR category+title).
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import {
  CLN_PASSWORD,
  cleanupTicketsWorld,
  createTicketsWorld,
  findActiveIssueOption,
  listenApp,
  closeServer,
  loginBearer,
  postJson,
  // Shape TicketsWorld documents the fixture/response fields this suite touches.
  type TicketsWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: ticket report validation.
describe("ticket report validation", () => {
  let world: TicketsWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let ownerToken: string;
  let activeOptionId: string;
  let activeCategoryId: string;
  let inactiveOptionId: string;
  let inactiveCategoryId: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createTicketsWorld(prisma);
    ({ server, api } = await listenApp());
    const login = await loginBearer(api, world.owner.email, CLN_PASSWORD);
    ownerToken = login.token;

    const option = await findActiveIssueOption(prisma);
    activeOptionId = option.id;
    activeCategoryId = option.maintenanceCategoryId;

    // inactiveCat: seeded entity required before the mutation under test.
    const inactiveCat = await prisma.maintenanceCategory.create({
      data: {
        key: `inactive_cat_${world.stamp}`.slice(0, 40),
        nameBg: "Inactive Cat",
        nameEn: "Inactive Cat",
        isActive: false,
        sortOrder: 9999,
      },
    });
    inactiveCategoryId = inactiveCat.id;

    // inactiveOpt: seeded entity required before the mutation under test.
    const inactiveOpt = await prisma.issueOption.create({
      data: {
        maintenanceCategoryId: activeCategoryId,
        kind: "maintenance",
        nameBg: "Inactive Opt",
        nameEn: "Inactive Opt",
        isActive: false,
        sortOrder: 9999,
      },
    });
    inactiveOptionId = inactiveOpt.id;
  });

  beforeEach(async () => {
    await prisma.ticketEvent.deleteMany({
      where: { ticket: { locationId: world.locationAId } },
    });
    await prisma.maintenanceTicket.deleteMany({
      where: { locationId: world.locationAId },
    });
  });

  after(async () => {
    if (inactiveOptionId) {
      await prisma.issueOption.deleteMany({ where: { id: inactiveOptionId } });
    }
    if (inactiveCategoryId) {
      await prisma.maintenanceCategory.deleteMany({
        where: { id: inactiveCategoryId },
      });
    }
    if (server) await closeServer(server);
    if (world) await cleanupTicketsWorld(prisma, world);
    await prisma.$disconnect();
  });

  // Local helper countTickets used by cases in this file.
  async function countTickets() {
    return prisma.maintenanceTicket.count({
      where: { locationId: world.locationAId },
    });
  }

  // Case: active issueOptionId alone succeeds.
  it("active issueOptionId alone succeeds", async () => {
    const before = await countTickets();
    const res = await postJson(api, ownerToken, "/maintenance/tickets", {
      locationId: world.locationAId,
      issueOptionId: activeOptionId,
      blocksRoom: false,
      commandId: randomUUID(),
    });
    assert.ok(res.status === 200 || res.status === 201);
    assert.equal(await countTickets(), before + 1);
  });

  // Case: active categoryId + title succeeds.
  it("active categoryId + title succeeds", async () => {
    const before = await countTickets();
    const res = await postJson(api, ownerToken, "/maintenance/tickets", {
      locationId: world.locationAId,
      categoryId: activeCategoryId,
      title: "Custom damage description",
      blocksRoom: false,
      commandId: randomUUID(),
    });
    assert.ok(res.status === 200 || res.status === 201);
    assert.equal(await countTickets(), before + 1);
  });

  // Case: neither selector rejected.
  it("neither selector rejected", async () => {
    const before = await countTickets();
    const res = await postJson(api, ownerToken, "/maintenance/tickets", {
      locationId: world.locationAId,
      title: "orphan",
      blocksRoom: false,
      commandId: randomUUID(),
    });
    assert.ok(res.status === 400 || res.status === 422);
    assert.equal(await countTickets(), before);
  });

  // Case: both selectors rejected.
  it("both selectors rejected", async () => {
    const before = await countTickets();
    const res = await postJson(api, ownerToken, "/maintenance/tickets", {
      locationId: world.locationAId,
      issueOptionId: activeOptionId,
      categoryId: activeCategoryId,
      title: "both",
      blocksRoom: false,
      commandId: randomUUID(),
    });
    assert.ok(res.status === 400 || res.status === 422);
    assert.equal(await countTickets(), before);
  });

  // Case: inactive option rejected.
  it("inactive option rejected", async () => {
    const before = await countTickets();
    const res = await postJson(api, ownerToken, "/maintenance/tickets", {
      locationId: world.locationAId,
      issueOptionId: inactiveOptionId,
      blocksRoom: false,
      commandId: randomUUID(),
    });
    assert.ok(res.status === 400 || res.status === 409);
    assert.equal(await countTickets(), before);
  });

  // Case: inactive category rejected.
  it("inactive category rejected", async () => {
    const before = await countTickets();
    const res = await postJson(api, ownerToken, "/maintenance/tickets", {
      locationId: world.locationAId,
      categoryId: inactiveCategoryId,
      title: "inactive cat",
      blocksRoom: false,
      commandId: randomUUID(),
    });
    assert.ok(res.status === 400 || res.status === 409);
    assert.equal(await countTickets(), before);
  });

  // Case: category without title rejected.
  it("category without title rejected", async () => {
    const before = await countTickets();
    const res = await postJson(api, ownerToken, "/maintenance/tickets", {
      locationId: world.locationAId,
      categoryId: activeCategoryId,
      blocksRoom: false,
      commandId: randomUUID(),
    });
    assert.ok(res.status === 400 || res.status === 422);
    assert.equal(await countTickets(), before);
  });
});
