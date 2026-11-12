/**
 * report validation (option XOR category+title).
 */
import assert from "node:assert/strict";
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import bindings from node:path.
import path from "node:path";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient } from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  cleanupTicketsWorld,
  // Execute the next setup or assertion step for this scenario.
  createTicketsWorld,
  // Execute the next setup or assertion step for this scenario.
  findActiveIssueOption,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  postJson,
  // Shape TicketsWorld documents the fixture/response fields this suite touches.
  type TicketsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Execute the next setup or assertion step for this scenario.
dotenv.config({
  // Execute the next setup or assertion step for this scenario.
  path: path.resolve(__dirname, "../../.env"),
  // Execute the next setup or assertion step for this scenario.
  override: true,
});

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: ticket report validation.
describe("ticket report validation", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: TicketsWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Execute the next setup or assertion step for this scenario.
  let ownerToken: string;
  // Execute the next setup or assertion step for this scenario.
  let activeOptionId: string;
  // Execute the next setup or assertion step for this scenario.
  let activeCategoryId: string;
  // Execute the next setup or assertion step for this scenario.
  let inactiveOptionId: string;
  // Execute the next setup or assertion step for this scenario.
  let inactiveCategoryId: string;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createTicketsWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());
    // login: synchronize actors so the race window is observable.
    const login = await loginBearer(api, world.owner.email, CLN_PASSWORD);
    // Session/CSRF step exercising auth lifecycle.
    ownerToken = login.token;

    // option: synchronize actors so the race window is observable.
    const option = await findActiveIssueOption(prisma);
    // Execute the next setup or assertion step for this scenario.
    activeOptionId = option.id;
    // Execute the next setup or assertion step for this scenario.
    activeCategoryId = option.maintenanceCategoryId;

    // inactiveCat: seeded entity required before the mutation under test.
    const inactiveCat = await prisma.maintenanceCategory.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        key: `inactive_cat_${world.stamp}`.slice(0, 40),
        // Execute the next setup or assertion step for this scenario.
        nameBg: "Inactive Cat",
        // Execute the next setup or assertion step for this scenario.
        nameEn: "Inactive Cat",
        // Execute the next setup or assertion step for this scenario.
        isActive: false,
        // Execute the next setup or assertion step for this scenario.
        sortOrder: 9999,
      },
    });
    // Execute the next setup or assertion step for this scenario.
    inactiveCategoryId = inactiveCat.id;

    // inactiveOpt: seeded entity required before the mutation under test.
    const inactiveOpt = await prisma.issueOption.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        maintenanceCategoryId: activeCategoryId,
        // Execute the next setup or assertion step for this scenario.
        kind: "maintenance",
        // Execute the next setup or assertion step for this scenario.
        nameBg: "Inactive Opt",
        // Execute the next setup or assertion step for this scenario.
        nameEn: "Inactive Opt",
        // Execute the next setup or assertion step for this scenario.
        isActive: false,
        // Execute the next setup or assertion step for this scenario.
        sortOrder: 9999,
      },
    });
    // Execute the next setup or assertion step for this scenario.
    inactiveOptionId = inactiveOpt.id;
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await prisma.ticketEvent.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { ticket: { locationId: world.locationAId } },
    });
    // Await async work before asserting or releasing locks.
    await prisma.maintenanceTicket.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { locationId: world.locationAId },
    });
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (inactiveOptionId) {
      // Await async work before asserting or releasing locks.
      await prisma.issueOption.deleteMany({ where: { id: inactiveOptionId } });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (inactiveCategoryId) {
      // Await async work before asserting or releasing locks.
      await prisma.maintenanceCategory.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: inactiveCategoryId },
      });
    }
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupTicketsWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Local helper countTickets used by cases in this file.
  async function countTickets() {
    // Return the arranged value/result to the caller.
    return prisma.maintenanceTicket.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { locationId: world.locationAId },
    });
  }

  // Case: active issueOptionId alone succeeds.
  it("active issueOptionId alone succeeds", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await countTickets();
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, ownerToken, "/maintenance/tickets", {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      issueOptionId: activeOptionId,
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Assert HTTP status matches the contract for this path.
    assert.ok(res.status === 200 || res.status === 201);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTickets(), before + 1);
  });

  // Case: active categoryId + title succeeds.
  it("active categoryId + title succeeds", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await countTickets();
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, ownerToken, "/maintenance/tickets", {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      categoryId: activeCategoryId,
      // Execute the next setup or assertion step for this scenario.
      title: "Custom damage description",
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Assert HTTP status matches the contract for this path.
    assert.ok(res.status === 200 || res.status === 201);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTickets(), before + 1);
  });

  // Case: neither selector rejected.
  it("neither selector rejected", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await countTickets();
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, ownerToken, "/maintenance/tickets", {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      title: "orphan",
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Assert HTTP status matches the contract for this path.
    assert.ok(res.status === 400 || res.status === 422);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTickets(), before);
  });

  // Case: both selectors rejected.
  it("both selectors rejected", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await countTickets();
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, ownerToken, "/maintenance/tickets", {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      issueOptionId: activeOptionId,
      // Execute the next setup or assertion step for this scenario.
      categoryId: activeCategoryId,
      // Execute the next setup or assertion step for this scenario.
      title: "both",
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Assert HTTP status matches the contract for this path.
    assert.ok(res.status === 400 || res.status === 422);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTickets(), before);
  });

  // Case: inactive option rejected.
  it("inactive option rejected", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await countTickets();
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, ownerToken, "/maintenance/tickets", {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      issueOptionId: inactiveOptionId,
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Assert HTTP status matches the contract for this path.
    assert.ok(res.status === 400 || res.status === 409);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTickets(), before);
  });

  // Case: inactive category rejected.
  it("inactive category rejected", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await countTickets();
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, ownerToken, "/maintenance/tickets", {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      categoryId: inactiveCategoryId,
      // Execute the next setup or assertion step for this scenario.
      title: "inactive cat",
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Assert HTTP status matches the contract for this path.
    assert.ok(res.status === 400 || res.status === 409);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTickets(), before);
  });

  // Case: category without title rejected.
  it("category without title rejected", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await countTickets();
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, ownerToken, "/maintenance/tickets", {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      categoryId: activeCategoryId,
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Assert HTTP status matches the contract for this path.
    assert.ok(res.status === 400 || res.status === 422);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTickets(), before);
  });
});
