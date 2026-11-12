/**
 * deterministic SSE live-authorization races against PostgreSQL locks.
 * Sleeps only poll for observed waiters; elapsed time never decides winners.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../src/db";
import { AppError } from "../../src/errors";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
import {
  cleanupScopeSmokeFixture,
  createScopeSmokeFixture,
  // Shape ScopeSmokeFixture documents the fixture/response fields this suite touches.
  type ScopeSmokeFixture,
} from "../fixtures";
// Shared test fixtures for seeding users, locations, and domain entities.
import { runWhileRowLocked } from "../cleaning/fixtures";
// HTTP harness to listen an in-process API for request-level tests.
import { listenApp, closeServer } from "../httpHarness";
import { publish } from "../../src/events/bus";
import {
  createSession,
  revokeSession,
} from "../../src/services/authSessions";
import {
  authorizeLiveDelivery,
  resetLiveAuthorizationTestHooks,
  setLiveAuthorizationTestHooks,
} from "../../src/services/liveAuthorization";
import {
  setSectorLocationsAtHead,
  updateSectorAtHead,
} from "../sectors/fixtures";
import { ensureDefaultRoleGrants } from "../../src/services/roleGrants";
import type { AuthUser } from "../../src/middleware/auth";
import type { LiveEvent } from "../../src/events/bus";
import type { Prisma as PrismaTypes } from "@prisma/client";

let fx: ScopeSmokeFixture;
let api: string;
let server: Awaited<ReturnType<typeof listenApp>>["server"];

// Local helper until used by cases in this file.
async function until(check: () => boolean, reason: string) {
  const end = Date.now() + 8_000;
  while (!check()) {
    assert.ok(Date.now() < end, reason);
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 5));
  }
}

// Helper authUserFrom: auth/session setup for the scenario.
function authUserFrom(
  tokens: { sessionId: string },
  user: {
    userId: string;
    employeeId: string;
    email: string;
    role: Role;
  },
): AuthUser {
  return {
    userId: user.userId,
    employeeId: user.employeeId,
    role: user.role,
    email: user.email,
    sid: tokens.sessionId,
  };
}

/** Swap A/B primary supervisors inside an already-locked writer transaction. */
async function swapSupervisorsInTx(tx: PrismaTypes.TransactionClient) {
  await tx.sector.update({
    where: { id: fx.sectorAId },
    data: { primarySupervisorEmployeeId: fx.supervisorB.employeeId },
  });
  await tx.sector.update({
    where: { id: fx.sectorBId },
    data: { primarySupervisorEmployeeId: fx.supervisorA.employeeId },
  });
}

// Local helper restoreSupervisors used by cases in this file.
async function restoreSupervisors() {
  await updateSectorAtHead(prisma, fx.sectorAId, {
    primarySupervisorEmployeeId: fx.supervisorA.employeeId,
    actorEmployeeId: fx.manager.employeeId,
  });
  await updateSectorAtHead(prisma, fx.sectorBId, {
    primarySupervisorEmployeeId: fx.supervisorB.employeeId,
    actorEmployeeId: fx.manager.employeeId,
  });
}

before(async () => {
  // Refuse to mutate unless connected to the isolated test database.
  await assertTestDatabase(prisma);
  process.env.E2E_DISABLE_RATE_LIMIT = "1";
  await ensureDefaultRoleGrants();
  fx = await createScopeSmokeFixture(prisma);
  ({ api, server } = await listenApp());
});

afterEach(async () => {
  resetLiveAuthorizationTestHooks();
  if (fx) {
    await prisma.sector.update({
      where: { id: fx.sectorAId },
      data: { primarySupervisorEmployeeId: fx.supervisorA.employeeId },
    });
    await prisma.sector.update({
      where: { id: fx.sectorBId },
      data: { primarySupervisorEmployeeId: fx.supervisorB.employeeId },
    });
    await prisma.user.update({
      where: { id: fx.supervisorA.userId },
      data: { role: Role.supervisor, isActive: true },
    });
    await prisma.sectorLocation.deleteMany({
      where: { locationId: { in: [fx.locAId, fx.locBId] } },
    });
    await prisma.sectorLocation.createMany({
      data: [
        { sectorId: fx.sectorAId, locationId: fx.locAId },
        { sectorId: fx.sectorBId, locationId: fx.locBId },
      ],
    });
  }
});

after(async () => {
  resetLiveAuthorizationTestHooks();
  if (server) await closeServer(server);
  if (fx) await cleanupScopeSmokeFixture(prisma, fx);
  await prisma.$disconnect();
});

// Suite: SSE authorization serialization.
describe("SSE authorization serialization", () => {
  // Case: 1+2: access change commits before delivery → event not delivered.
  it("1+2: access change commits before delivery → event not delivered", async () => {
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    const user = authUserFrom(tokens, fx.supervisorA);
    const event: LiveEvent = {
      type: "location.changed",
      locationId: fx.locAId,
      at: new Date().toISOString(),
    };
    let delivered = false;

    // Holder locks both supervisors and stages the scope flip; delivery waits
    // on FOR SHARE until that writer commits.
    const result = await runWhileRowLocked({
      prisma,
      acquireLock: async (tx) => {
        await tx.$executeRaw`
          SELECT id FROM "User"
          WHERE id IN (${Prisma.join([fx.supervisorA.userId, fx.supervisorB.userId])})
          ORDER BY id FOR UPDATE
        `;
        await swapSupervisorsInTx(tx);
      },
      startRace: () =>
        authorizeLiveDelivery(user, event, () => {
          delivered = true;
        }),
      whileBlocked: async () => undefined,
    });

    assert.equal(result.delivered, false);
    assert.equal(delivered, false);
    await restoreSupervisors();
  });

  // Case: 3: delivery linearized before sector revoke → frame written, then scope flips.
  it("3: delivery linearized before sector revoke → frame written, then scope flips", async () => {
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    const user = authUserFrom(tokens, fx.supervisorA);
    const event: LiveEvent = {
      type: "location.changed",
      locationId: fx.locAId,
      at: new Date().toISOString(),
    };
    let delivered = false;
    let releaseHook!: () => void;
    let enteredHook!: () => void;
    const inHook = new Promise<void>((resolve) => {
      enteredHook = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });

    setLiveAuthorizationTestHooks({
      afterScopeResolved: async () => {
        enteredHook();
        await gate;
      },
    });

    const delivery = authorizeLiveDelivery(user, event, () => {
      delivered = true;
    });
    await inHook;

    // Delivery holds User FOR SHARE. Writer must wait — prove via lock waiters.
    const writer = updateSectorAtHead(prisma, fx.sectorAId, {
      primarySupervisorEmployeeId: fx.supervisorB.employeeId,
      actorEmployeeId: fx.manager.employeeId,
    });
    // Fire-and-await side effect required before the next assertion.
    void writer.catch(() => undefined);

    // deadline: bound how long the wait/poll may run.
    const deadline = Date.now() + 8_000;
    // writerWaiting: repetition count to amplify race windows.
    let writerWaiting = false;
    // Repeat/poll to widen the race window or wait for lock waiters.
    while (Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND pid <> pg_backend_pid()
      `;
      if ((row?.count ?? 0) >= 1) {
        writerWaiting = true;
        break;
      }
      // Brief yield so lock waiters/UI can settle before asserting.
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(writerWaiting, true, "sector writer must wait on User FOR SHARE");

    releaseHook();
    const result = await delivery;
    assert.equal(result.delivered, true);
    assert.equal(delivered, true);
    await writer;

    let second = false;
    const refused = await authorizeLiveDelivery(user, event, () => {
      second = true;
    });
    assert.equal(refused.delivered, false);
    assert.equal(second, false);

    await restoreSupervisors();
  });

  // Case checks authz/session policy: 4: logout/revoke during event processing → no delivery + stream closes.
  it("4: logout/revoke during event processing → no delivery + stream closes", async () => {
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    const user = authUserFrom(tokens, fx.supervisorA);
    const event: LiveEvent = {
      type: "people.changed",
      at: new Date().toISOString(),
    };
    let delivered = false;

    // Revoke staged under User FOR UPDATE; delivery blocks on FOR SHARE.
    await assert.rejects(
      () =>
        runWhileRowLocked({
          prisma,
          acquireLock: async (tx) => {
            await tx.$executeRaw`
              SELECT id FROM "User" WHERE id = ${fx.supervisorA.userId} FOR UPDATE
            `;
            await tx.authSession.updateMany({
              where: { id: tokens.sessionId, revokedAt: null },
              data: { revokedAt: new Date() },
            });
          },
          startRace: () =>
            authorizeLiveDelivery(user, event, () => {
              delivered = true;
            }),
          whileBlocked: async () => undefined,
        }),
      /Session revoked|unauthorized/i,
    );
    assert.equal(delivered, false);

    // Open stream with a fresh session, then revoke via the production path.
    const live = await createSession({ userId: fx.supervisorA.userId });
    const controller = new AbortController();
    const response = await fetch(`${api}/events/stream`, {
      // Configure headers for the request/server under test.
      headers: { Authorization: `Bearer ${live.accessToken}` },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    let text = "";
    let closed = false;
    const reader = response.body!.getReader();
    const pump = (async () => {
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          text += new TextDecoder().decode(result.value, { stream: true });
        }
      } catch (err) {
        if (!controller.signal.aborted) throw err;
      } finally {
        closed = true;
        reader.releaseLock();
      }
    })();

    try {
      await until(() => text.includes("event: connected"), "connected");
      const before = text.length;
      await revokeSession(live.sessionId);
      publish("people.changed");
      await until(() => closed, "stream must close after revokeSession");
      assert.match(text, /event: revoked/);
      assert.equal(text.slice(before).includes("event: people.changed"), false);
    } finally {
      controller.abort();
      await pump;
    }
  });

  // Case: 5: session expiry during processing → no delivery.
  it("5: session expiry during processing → no delivery", async () => {
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    const user = authUserFrom(tokens, fx.supervisorA);
    const event: LiveEvent = {
      type: "people.changed",
      at: new Date().toISOString(),
    };
    let delivered = false;

    await assert.rejects(
      () =>
        runWhileRowLocked({
          prisma,
          acquireLock: async (tx) => {
            await tx.$executeRaw`
              SELECT id FROM "User" WHERE id = ${fx.supervisorA.userId} FOR UPDATE
            `;
            await tx.authSession.update({
              where: { id: tokens.sessionId },
              data: { expiresAt: new Date(Date.now() - 1) },
            });
          },
          startRace: () =>
            authorizeLiveDelivery(user, event, () => {
              delivered = true;
            }),
          whileBlocked: async () => undefined,
        }),
      /Session expired|unauthorized/i,
    );
    assert.equal(delivered, false);
  });

  // Case probes concurrency/isolation: 6: concurrent events + sector change — only in-scope deliveries.
  it("6: concurrent events + sector change — only in-scope deliveries", async () => {
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    const user = authUserFrom(tokens, fx.supervisorA);
    const seen: string[] = [];

    const results = await runWhileRowLocked({
      prisma,
      acquireLock: async (tx) => {
        await tx.$executeRaw`
          SELECT id FROM "User"
          WHERE id IN (${Prisma.join([fx.supervisorA.userId, fx.supervisorB.userId])})
          ORDER BY id FOR UPDATE
        `;
        await swapSupervisorsInTx(tx);
      },
      startRace: async () => {
        // Run actors together to expose races and serialization bugs.
        const [ra, rb] = await Promise.all([
          authorizeLiveDelivery(
            user,
            {
              type: "location.changed",
              locationId: fx.locAId,
              at: new Date().toISOString(),
            },
            (e) => seen.push(e.locationId ?? "a"),
          ),
          authorizeLiveDelivery(
            user,
            {
              type: "location.changed",
              locationId: fx.locBId,
              at: new Date().toISOString(),
            },
            (e) => seen.push(e.locationId ?? "b"),
          ),
        ]);
        return { ra, rb };
      },
      whileBlocked: async () => undefined,
    });

    assert.equal(results.ra.delivered, false);
    assert.equal(results.rb.delivered, true);
    assert.deepEqual(seen, [fx.locBId]);
  });

  // Case: 7: role change without client reconnect closes stream before further frames.
  it("7: role change without client reconnect closes stream before further frames", async () => {
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    const controller = new AbortController();
    const response = await fetch(`${api}/events/stream`, {
      // Configure headers for the request/server under test.
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      signal: controller.signal,
    });
    let text = "";
    let closed = false;
    const reader = response.body!.getReader();
    const pump = (async () => {
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          text += new TextDecoder().decode(result.value, { stream: true });
        }
      } catch (err) {
        if (!controller.signal.aborted) throw err;
      } finally {
        closed = true;
        reader.releaseLock();
      }
    })();

    try {
      await until(() => text.includes("event: connected"), "connected");
      const before = text.length;
      // login: seeded entity required before the mutation under test.
      const login = await createSession({ userId: fx.manager.userId });
      const roleRes = await fetch(
        `${api}/people/${fx.supervisorA.userId}/role`,
        {
          // Configure method for the request/server under test.
          method: "PATCH",
          // Configure headers for the request/server under test.
          headers: {
            Authorization: `Bearer ${login.accessToken}`,
            "Content-Type": "application/json",
          },
          // Configure body for the request/server under test.
          body: JSON.stringify({ role: Role.housekeeper }),
        },
      );
      assert.equal(roleRes.status, 200);
      publish("people.changed");
      publish("location.changed", { locationId: fx.locAId });
      await until(() => closed, "role change must revoke open SSE");
      assert.match(text, /event: revoked/);
      assert.equal(text.slice(before).includes("event: people.changed"), false);
      assert.equal(text.slice(before).includes(fx.locAId), false);
    } finally {
      controller.abort();
      await pump;
      await prisma.user.update({
        where: { id: fx.supervisorA.userId },
        data: { role: Role.supervisor },
      });
    }
  });

  // Case: 8: valid subscriber keeps receiving in-scope events.
  it("8: valid subscriber keeps receiving in-scope events", async () => {
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    const controller = new AbortController();
    const response = await fetch(`${api}/events/stream`, {
      // Configure headers for the request/server under test.
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      signal: controller.signal,
    });
    let text = "";
    const reader = response.body!.getReader();
    const pump = (async () => {
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          text += new TextDecoder().decode(result.value, { stream: true });
        }
      } catch (err) {
        if (!controller.signal.aborted) throw err;
      } finally {
        reader.releaseLock();
      }
    })();

    try {
      await until(() => text.includes("event: connected"), "connected");
      publish("location.changed", { locationId: fx.locBId });
      publish("location.changed", { locationId: fx.locAId });
      await until(() => text.includes(fx.locAId), "in-scope event");
      assert.equal(text.includes(fx.locBId), false);
      const mid = text.length;
      publish("settings.changed");
      await until(
        () => text.slice(mid).includes("event: settings.changed"),
        "global invalidate still delivered",
      );
    } finally {
      controller.abort();
      await pump;
    }
  });

  // Case: 9: no deliveries after stream termination.
  it("9: no deliveries after stream termination", async () => {
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    const controller = new AbortController();
    const response = await fetch(`${api}/events/stream`, {
      // Configure headers for the request/server under test.
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      signal: controller.signal,
    });
    let text = "";
    let closed = false;
    const reader = response.body!.getReader();
    const pump = (async () => {
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          text += new TextDecoder().decode(result.value, { stream: true });
        }
      } catch (err) {
        if (!controller.signal.aborted) throw err;
      } finally {
        closed = true;
        reader.releaseLock();
      }
    })();

    try {
      await until(() => text.includes("event: connected"), "connected");
      await revokeSession(tokens.sessionId);
      publish("people.changed");
      await until(() => closed, "EOF after revoke");
      const end = text.length;
      publish("location.changed", { locationId: fx.locAId });
      publish("people.changed");
      // Brief settle only to catch late writes; length must stay fixed.
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(text.length, end);
    } finally {
      controller.abort();
      await pump;
    }
  });

  // Case probes concurrency/isolation: 10: no deadlock — delivery, updateSector, and setSectorLocations complete.
  it("10: no deadlock — delivery, updateSector, and setSectorLocations complete", async () => {
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    const user = authUserFrom(tokens, fx.supervisorA);
    const event: LiveEvent = {
      type: "location.changed",
      locationId: fx.locAId,
      at: new Date().toISOString(),
    };

    const delivery = authorizeLiveDelivery(user, event, () => undefined);
    // writer: repetition count to amplify race windows.
    const writer = updateSectorAtHead(prisma, fx.sectorAId, {
      nameBg: `Sector A ${Date.now()}`,
      actorEmployeeId: fx.manager.employeeId,
    });
    const swap = updateSectorAtHead(prisma, fx.sectorAId, {
      primarySupervisorEmployeeId: fx.supervisorB.employeeId,
      actorEmployeeId: fx.manager.employeeId,
    });
    const membership = setSectorLocationsAtHead(prisma, fx.sectorBId, [fx.locBId], {
      actorEmployeeId: fx.manager.employeeId,
      scope: {
        kind: "all",
        sectorIds: [],
        employeeId: fx.manager.employeeId,
        role: Role.manager,
      },
      allowCrossSectorTransfer: true,
    });

    // settled: capture concurrent outcomes for race assertions.
    const settled = await Promise.allSettled([
      delivery,
      writer,
      swap,
      membership,
    ]);
    // Delivery + cross-sector membership must complete; concurrent same-sector
    // writers may lose expectedVersion CAS (409) but must not hang.
    assert.equal(settled[0]!.status, "fulfilled", "delivery");
    assert.equal(settled[3]!.status, "fulfilled", "membership");
    const sectorWrites = [settled[1]!, settled[2]!];
    assert.ok(
      sectorWrites.some((s) => s.status === "fulfilled"),
      "at least one sectorA writer must succeed",
    );
    for (const s of sectorWrites) {
      if (s.status === "fulfilled") continue;
      const err = s.reason;
      assert.ok(
        err instanceof AppError &&
          err.status === 409 &&
          err.code === "version_conflict",
        `unexpected sector write failure: ${String(err)}`,
      );
    }

    // Restore membership + supervisors for fixture reuse.
    await setSectorLocationsAtHead(prisma, fx.sectorAId, [fx.locAId], {
      actorEmployeeId: fx.manager.employeeId,
      scope: {
        kind: "all",
        sectorIds: [],
        employeeId: fx.manager.employeeId,
        role: Role.manager,
      },
      allowCrossSectorTransfer: true,
    });
    await setSectorLocationsAtHead(prisma, fx.sectorBId, [fx.locBId], {
      actorEmployeeId: fx.manager.employeeId,
      scope: {
        kind: "all",
        sectorIds: [],
        employeeId: fx.manager.employeeId,
        role: Role.manager,
      },
      allowCrossSectorTransfer: true,
    });
    await restoreSupervisors();
  });

  // Case: membership move commits before delivery → location event refused.
  it("membership move commits before delivery → location event refused", async () => {
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    const user = authUserFrom(tokens, fx.supervisorA);
    const event: LiveEvent = {
      type: "location.changed",
      locationId: fx.locAId,
      at: new Date().toISOString(),
    };
    let delivered = false;

    // Membership writers take Sector FOR NO KEY UPDATE; SSE takes Sector FOR SHARE.
    const result = await runWhileRowLocked({
      prisma,
      acquireLock: async (tx) => {
        await tx.$executeRaw`
          SELECT id FROM "Sector"
          WHERE id IN (${Prisma.join([fx.sectorAId, fx.sectorBId])})
          ORDER BY id FOR NO KEY UPDATE
        `;
        await tx.sectorLocation.deleteMany({ where: { locationId: fx.locAId } });
        await tx.sectorLocation.create({
          data: { sectorId: fx.sectorBId, locationId: fx.locAId },
        });
      },
      startRace: () =>
        authorizeLiveDelivery(user, event, () => {
          delivered = true;
        }),
      whileBlocked: async () => undefined,
    });

    assert.equal(result.delivered, false);
    assert.equal(delivered, false);
  });
});
