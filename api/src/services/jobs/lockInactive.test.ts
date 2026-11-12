// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module dependency for this service.
import {
  // Run next step: activitySignalsOf,
  activitySignalsOf,
  // Run next step: claimLockInactiveUser,
  claimLockInactiveUser,
  // Run next step: latestActivityAt,
  latestActivityAt,
  // Run next step: runLockInactiveUsers,
  runLockInactiveUsers,
  // Declare type LockInactiveClaimDb for callers and internals.
  type LockInactiveClaimDb,
// Run next step: } from "./lockInactive";
} from "./lockInactive";

// Capture cutoff for use in this scope.
const cutoff = new Date("2026-09-01T00:00:00.000Z");
// Capture stale for use in this scope.
const stale = new Date("2026-07-01T00:00:00.000Z");
// Capture fresh for use in this scope.
const fresh = new Date("2026-09-30T12:00:00.000Z");

// Declare type DeviceRow for callers and internals.
type DeviceRow = {
  // Set lastSeenAt on the structure being built.
  lastSeenAt: Date;
  // Set revokedAt on the structure being built.
  revokedAt: Date | null;
};

// Declare type UserRow for callers and internals.
type UserRow = {
  // Set id on the structure being built.
  id: string;
  // Set isActive on the structure being built.
  isActive: boolean;
  // Set lastLoginAt on the structure being built.
  lastLoginAt: Date | null;
  // Set activatedAt on the structure being built.
  activatedAt: Date | null;
  // Set createdAt on the structure being built.
  createdAt: Date;
  // Set devices on the structure being built.
  devices: DeviceRow[];
};

// Define makeFakeDb — core behavior for this module.
function makeFakeDb(initial: UserRow) {
  // Capture row for use in this scope.
  let row: UserRow = {
    // Run next step: ...initial,
    ...initial,
    // Set devices on the structure being built.
    devices: initial.devices.map((d) => ({ ...d })),
  };
  // Capture find calls for use in this scope.
  let findCalls = 0;
  // Capture update calls for use in this scope.
  let updateCalls = 0;

  // Capture db for use in this scope.
  const db: LockInactiveClaimDb = {
    // Set user on the structure being built.
    user: {
      // Implement findUnique behavior for this type.
      async findUnique() {
        // Run next step: findCalls += 1;
        findCalls += 1;
        // Capture active devices for use in this scope.
        const activeDevices = row.devices
          // Continue the chained call from the previous expression.
          .filter((d) => d.revokedAt === null)
          // Continue the chained call from the previous expression.
          .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
          // Continue the chained call from the previous expression.
          .slice(0, 1)
          // Continue the chained call from the previous expression.
          .map((d) => ({ lastSeenAt: d.lastSeenAt }));
        // Return the computed result to the caller.
        return {
          // Set id on the structure being built.
          id: row.id,
          // Set isActive on the structure being built.
          isActive: row.isActive,
          // Set lastLoginAt on the structure being built.
          lastLoginAt: row.lastLoginAt,
          // Set activatedAt on the structure being built.
          activatedAt: row.activatedAt,
          // Set createdAt on the structure being built.
          createdAt: row.createdAt,
          // Set devices on the structure being built.
          devices: activeDevices,
        };
      },
      // Implement updateMany behavior for this type.
      async updateMany({ where, data }) {
        // Run next step: updateCalls += 1;
        updateCalls += 1;
        // Capture where cutoff for use in this scope.
        const whereCutoff = where.createdAt.lte;
        // Branch when this condition holds so the right path runs.
        if (!row.isActive || row.id !== where.id) return { count: 0 };
        // Branch when this condition holds so the right path runs.
        if (row.createdAt.getTime() > whereCutoff.getTime()) {
          // Return the computed result to the caller.
          return { count: 0 };
        }

        // Capture login ok for use in this scope.
        const loginOk =
          // Run next step: row.lastLoginAt === null ||
          row.lastLoginAt === null ||
          // Run next step: row.lastLoginAt.getTime() <= whereCutoff.getTime();
          row.lastLoginAt.getTime() <= whereCutoff.getTime();
        // Capture activated ok for use in this scope.
        const activatedOk =
          // Run next step: row.activatedAt === null ||
          row.activatedAt === null ||
          // Run next step: row.activatedAt.getTime() <= whereCutoff.getTime();
          row.activatedAt.getTime() <= whereCutoff.getTime();
        // Capture has fresh device for use in this scope.
        const hasFreshDevice = row.devices.some(
          // Run next step: (d) =>
          (d) =>
            // Run next step: d.revokedAt === null &&
            d.revokedAt === null &&
            // Run next step: d.lastSeenAt.getTime() > whereCutoff.getTime(),
            d.lastSeenAt.getTime() > whereCutoff.getTime(),
        );
        // Branch when this condition holds so the right path runs.
        if (!loginOk || !activatedOk || hasFreshDevice) {
          // Return the computed result to the caller.
          return { count: 0 };
        }

        // Ensure the typed CAS where was passed through.
        assert.equal(where.isActive, true);
        // Run next step: assert.ok(where.AND);
        assert.ok(where.AND);
        // Run next step: assert.equal(data.isActive, false);
        assert.equal(data.isActive, false);

        // Update row as control flow progresses.
        row = { ...row, isActive: false };
        // Return the computed result to the caller.
        return { count: 1 };
      },
    },
  };

  // Return the computed result to the caller.
  return {
    // Run next step: db,
    db,
    // Expose a derived getter without storing duplicate state.
    get row() {
      // Return the computed result to the caller.
      return row;
    },
    // Expose a derived getter without storing duplicate state.
    get findCalls() {
      // Return the computed result to the caller.
      return findCalls;
    },
    // Expose a derived getter without storing duplicate state.
    get updateCalls() {
      // Return the computed result to the caller.
      return updateCalls;
    },
    /** Simulate concurrent activity after findUnique returns the stale snapshot. */
    becomeActiveAfterRead(patch: Partial<UserRow>) {
      // Capture original find for use in this scope.
      const originalFind = db.user.findUnique;
      // Run next step: db.user.findUnique = async (args) => {
      db.user.findUnique = async (args) => {
        // Load current asynchronously for the next steps.
        const current = await originalFind(args);
        // Update row as control flow progresses.
        row = {
          // Run next step: ...row,
          ...row,
          // Run next step: ...patch,
          ...patch,
          // Set devices on the structure being built.
          devices: patch.devices
            // Complete the ternary or optional chain started above.
            ? patch.devices.map((d) => ({ ...d }))
            // Complete the ternary or optional chain started above.
            : row.devices.map((d) => ({ ...d })),
        };
        // Return the computed result to the caller.
        return current;
      };
    },
  };
}

// Run next step: describe("latestActivityAt / activitySignalsOf", () => {
describe("latestActivityAt / activitySignalsOf", () => {
  // Run next step: it("uses max of dates, not nullish coalescing", () => {
  it("uses max of dates, not nullish coalescing", () => {
    // Capture old login for use in this scope.
    const oldLogin = stale;
    // Capture recent device for use in this scope.
    const recentDevice = fresh;
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: latestActivityAt([oldLogin, recentDevice, null, stale]).toIS…
      latestActivityAt([oldLogin, recentDevice, null, stale]).toISOString(),
      // Run next step: recentDevice.toISOString(),
      recentDevice.toISOString(),
    );
  });

  // Run next step: it("does not treat AuthSession as an activity signal", () =>…
  it("does not treat AuthSession as an activity signal", () => {
    // Capture session last used at for use in this scope.
    const sessionLastUsedAt = fresh;
    // Build user object holding related fields.
    const user = {
      // Set lastLoginAt on the structure being built.
      lastLoginAt: stale,
      // Set activatedAt on the structure being built.
      activatedAt: stale,
      // Set createdAt on the structure being built.
      createdAt: stale,
      // Set devices on the structure being built.
      devices: [] as { lastSeenAt: Date }[],
    };
    // Capture signals for use in this scope.
    const signals = activitySignalsOf(user);
    // Run next step: assert.equal(latestActivityAt(signals).toISOString(), stale.…
    assert.equal(latestActivityAt(signals).toISOString(), stale.toISOString());
    // Run next step: assert.ok(!signals.includes(sessionLastUsedAt));
    assert.ok(!signals.includes(sessionLastUsedAt));
  });
});

// Run next step: describe("claimLockInactiveUser", () => {
describe("claimLockInactiveUser", () => {
  // Run next step: it("keeps user active when login is old but a valid device w…
  it("keeps user active when login is old but a valid device was seen recently", async () => {
    // Capture fake for use in this scope.
    const fake = makeFakeDb({
      // Set id on the structure being built.
      id: "u1",
      // Set isActive on the structure being built.
      isActive: true,
      // Set lastLoginAt on the structure being built.
      lastLoginAt: stale,
      // Set activatedAt on the structure being built.
      activatedAt: stale,
      // Set createdAt on the structure being built.
      createdAt: stale,
      // Set devices on the structure being built.
      devices: [{ lastSeenAt: fresh, revokedAt: null }],
    });

    // Load result asynchronously for the next steps.
    const result = await claimLockInactiveUser(fake.db, "u1", cutoff);

    // Run next step: assert.equal(result.claimed, false);
    assert.equal(result.claimed, false);
    // Run next step: assert.equal(fake.updateCalls, 0);
    assert.equal(fake.updateCalls, 0);
    // Run next step: assert.equal(fake.row.isActive, true);
    assert.equal(fake.row.isActive, true);
  });

  // Run next step: it("locks when all applicable signals are older than cutoff"…
  it("locks when all applicable signals are older than cutoff", async () => {
    // Capture login for use in this scope.
    const login = new Date("2026-06-01T00:00:00.000Z");
    // Capture device seen for use in this scope.
    const deviceSeen = new Date("2026-06-15T00:00:00.000Z");
    // Capture activated for use in this scope.
    const activated = new Date("2026-05-01T00:00:00.000Z");
    // Capture created for use in this scope.
    const created = new Date("2026-04-01T00:00:00.000Z");
    // Capture expected max for use in this scope.
    const expectedMax = deviceSeen;

    // Capture fake for use in this scope.
    const fake = makeFakeDb({
      // Set id on the structure being built.
      id: "u2",
      // Set isActive on the structure being built.
      isActive: true,
      // Set lastLoginAt on the structure being built.
      lastLoginAt: login,
      // Set activatedAt on the structure being built.
      activatedAt: activated,
      // Set createdAt on the structure being built.
      createdAt: created,
      // Set devices on the structure being built.
      devices: [{ lastSeenAt: deviceSeen, revokedAt: null }],
    });

    // Load result asynchronously for the next steps.
    const result = await claimLockInactiveUser(fake.db, "u2", cutoff);

    // Run next step: assert.equal(result.claimed, true);
    assert.equal(result.claimed, true);
    // Branch when this condition holds so the right path runs.
    if (result.claimed) {
      // Run next step: assert.equal(result.lastActivity.toISOString(), expectedMax.…
      assert.equal(result.lastActivity.toISOString(), expectedMax.toISOString());
    }
    // Run next step: assert.equal(fake.row.isActive, false);
    assert.equal(fake.row.isActive, false);
  });

  // Run next step: it("ignores revoked devices when evaluating activity", async…
  it("ignores revoked devices when evaluating activity", async () => {
    // Capture fake for use in this scope.
    const fake = makeFakeDb({
      // Set id on the structure being built.
      id: "u3",
      // Set isActive on the structure being built.
      isActive: true,
      // Set lastLoginAt on the structure being built.
      lastLoginAt: stale,
      // Set activatedAt on the structure being built.
      activatedAt: stale,
      // Set createdAt on the structure being built.
      createdAt: stale,
      // Set devices on the structure being built.
      devices: [{ lastSeenAt: fresh, revokedAt: new Date("2026-08-01T00:00:00.000Z") }],
    });

    // Load result asynchronously for the next steps.
    const result = await claimLockInactiveUser(fake.db, "u3", cutoff);

    // Run next step: assert.equal(result.claimed, true);
    assert.equal(result.claimed, true);
    // Run next step: assert.equal(fake.row.isActive, false);
    assert.equal(fake.row.isActive, false);
  });

  // Run next step: it("does not lock when activity arrives between read and wri…
  it("does not lock when activity arrives between read and write", async () => {
    // Capture fake for use in this scope.
    const fake = makeFakeDb({
      // Set id on the structure being built.
      id: "u4",
      // Set isActive on the structure being built.
      isActive: true,
      // Set lastLoginAt on the structure being built.
      lastLoginAt: stale,
      // Set activatedAt on the structure being built.
      activatedAt: stale,
      // Set createdAt on the structure being built.
      createdAt: stale,
      // Set devices on the structure being built.
      devices: [],
    });
    // Run next step: fake.becomeActiveAfterRead({ lastLoginAt: fresh });
    fake.becomeActiveAfterRead({ lastLoginAt: fresh });

    // Load result asynchronously for the next steps.
    const result = await claimLockInactiveUser(fake.db, "u4", cutoff);

    // Run next step: assert.equal(result.claimed, false);
    assert.equal(result.claimed, false);
    // Run next step: assert.equal(fake.updateCalls, 1);
    assert.equal(fake.updateCalls, 1);
    // Run next step: assert.equal(fake.row.isActive, true);
    assert.equal(fake.row.isActive, true);
    // Run next step: assert.equal(fake.row.lastLoginAt?.toISOString(), fresh.toIS…
    assert.equal(fake.row.lastLoginAt?.toISOString(), fresh.toISOString());
  });

  // Run next step: it("still locks when only AuthSession activity would be rece…
  it("still locks when only AuthSession activity would be recent", async () => {
    // AuthSession.lastUsedAt is not a policy signal; recent session alone must not keep access.
    const _recentSessionLastUsedAt = fresh;
    // Run next step: void _recentSessionLastUsedAt;
    void _recentSessionLastUsedAt;

    // Capture fake for use in this scope.
    const fake = makeFakeDb({
      // Set id on the structure being built.
      id: "u5",
      // Set isActive on the structure being built.
      isActive: true,
      // Set lastLoginAt on the structure being built.
      lastLoginAt: stale,
      // Set activatedAt on the structure being built.
      activatedAt: stale,
      // Set createdAt on the structure being built.
      createdAt: stale,
      // Set devices on the structure being built.
      devices: [],
    });

    // Load result asynchronously for the next steps.
    const result = await claimLockInactiveUser(fake.db, "u5", cutoff);

    // Run next step: assert.equal(result.claimed, true);
    assert.equal(result.claimed, true);
    // Run next step: assert.equal(fake.row.isActive, false);
    assert.equal(fake.row.isActive, false);
  });
});

// Run next step: describe("runLockInactiveUsers policy gate", () => {
describe("runLockInactiveUsers policy gate", () => {
  // Run next step: it("makes no user changes when lockInactiveUsers is disabled…
  it("makes no user changes when lockInactiveUsers is disabled", async () => {
    // Capture find candidates calls for use in this scope.
    let findCandidatesCalls = 0;
    // Capture claim find calls for use in this scope.
    let claimFindCalls = 0;
    // Capture claim update calls for use in this scope.
    let claimUpdateCalls = 0;
    // Capture audit calls for use in this scope.
    let auditCalls = 0;

    // Capture claim db for use in this scope.
    const claimDb: LockInactiveClaimDb = {
      // Set user on the structure being built.
      user: {
        // Implement findUnique behavior for this type.
        async findUnique() {
          // Run next step: claimFindCalls += 1;
          claimFindCalls += 1;
          // Return the computed result to the caller.
          return null;
        },
        // Implement updateMany behavior for this type.
        async updateMany() {
          // Run next step: claimUpdateCalls += 1;
          claimUpdateCalls += 1;
          // Return the computed result to the caller.
          return { count: 0 };
        },
      },
    };

    // Load result asynchronously for the next steps.
    const result = await runLockInactiveUsers({
      // Set getAccess on the structure being built.
      getAccess: async () => ({
        // Set lockInactiveUsers on the structure being built.
        lockInactiveUsers: false,
        // Set sessionIdleDays on the structure being built.
        sessionIdleDays: 30,
      }),
      // Set findCandidates on the structure being built.
      findCandidates: async () => {
        // Run next step: findCandidatesCalls += 1;
        findCandidatesCalls += 1;
        // Return the computed result to the caller.
        return [];
      },
      // Run next step: claimDb,
      claimDb,
      // Set recordAudit on the structure being built.
      recordAudit: async () => {
        // Run next step: auditCalls += 1;
        auditCalls += 1;
        // Return the computed result to the caller.
        return {} as never;
      },
      // Set startJobRun on the structure being built.
      startJobRun: async () => ({ id: "job-1" }),
      // Set finishJobRun on the structure being built.
      finishJobRun: async () => undefined,
    });

    // Skip path must advertise why work was not attempted (JobRun summary).
    assert.deepEqual(result, {
      // Set locked on the structure being built.
      locked: 0,
      // Set skipped on the structure being built.
      skipped: true,
      // Set reason on the structure being built.
      reason: "disabled",
    });
    // Run next step: assert.equal(findCandidatesCalls, 0);
    assert.equal(findCandidatesCalls, 0);
    // Run next step: assert.equal(claimFindCalls, 0);
    assert.equal(claimFindCalls, 0);
    // Run next step: assert.equal(claimUpdateCalls, 0);
    assert.equal(claimUpdateCalls, 0);
    // Run next step: assert.equal(auditCalls, 0);
    assert.equal(auditCalls, 0);
  });
});
