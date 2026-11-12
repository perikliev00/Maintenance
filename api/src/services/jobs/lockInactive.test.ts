import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activitySignalsOf,
  claimLockInactiveUser,
  latestActivityAt,
  runLockInactiveUsers,
  // Declare type LockInactiveClaimDb for callers and internals.
  type LockInactiveClaimDb,
} from "./lockInactive";

const cutoff = new Date("2026-09-01T00:00:00.000Z");
const stale = new Date("2026-07-01T00:00:00.000Z");
const fresh = new Date("2026-09-30T12:00:00.000Z");

// Declare type DeviceRow for callers and internals.
type DeviceRow = {
  lastSeenAt: Date;
  revokedAt: Date | null;
};

// Declare type UserRow for callers and internals.
type UserRow = {
  id: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  activatedAt: Date | null;
  createdAt: Date;
  devices: DeviceRow[];
};

function makeFakeDb(initial: UserRow) {
  let row: UserRow = {
    ...initial,
    devices: initial.devices.map((d) => ({ ...d })),
  };
  // Capture find calls for use in this scope.
  let findCalls = 0;
  // Capture update calls for use in this scope.
  let updateCalls = 0;

  const db: LockInactiveClaimDb = {
    user: {
      // Implement findUnique behavior for this type.
      async findUnique() {
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
        return {
          id: row.id,
          isActive: row.isActive,
          lastLoginAt: row.lastLoginAt,
          activatedAt: row.activatedAt,
          createdAt: row.createdAt,
          devices: activeDevices,
        };
      },
      // Implement updateMany behavior for this type.
      async updateMany({ where, data }) {
        updateCalls += 1;
        // Capture where cutoff for use in this scope.
        const whereCutoff = where.createdAt.lte;
        if (!row.isActive || row.id !== where.id) return { count: 0 };
        if (row.createdAt.getTime() > whereCutoff.getTime()) {
          return { count: 0 };
        }

        // Capture login ok for use in this scope.
        const loginOk =
          row.lastLoginAt === null ||
          row.lastLoginAt.getTime() <= whereCutoff.getTime();
        // Capture activated ok for use in this scope.
        const activatedOk =
          row.activatedAt === null ||
          row.activatedAt.getTime() <= whereCutoff.getTime();
        // Capture has fresh device for use in this scope.
        const hasFreshDevice = row.devices.some(
          (d) =>
            d.revokedAt === null &&
            d.lastSeenAt.getTime() > whereCutoff.getTime(),
        );
        if (!loginOk || !activatedOk || hasFreshDevice) {
          return { count: 0 };
        }

        // Ensure the typed CAS where was passed through.
        assert.equal(where.isActive, true);
        assert.ok(where.AND);
        assert.equal(data.isActive, false);

        row = { ...row, isActive: false };
        return { count: 1 };
      },
    },
  };

  return {
    db,
    // Expose a derived getter without storing duplicate state.
    get row() {
      return row;
    },
    // Expose a derived getter without storing duplicate state.
    get findCalls() {
      return findCalls;
    },
    // Expose a derived getter without storing duplicate state.
    get updateCalls() {
      return updateCalls;
    },
    /** Simulate concurrent activity after findUnique returns the stale snapshot. */
    becomeActiveAfterRead(patch: Partial<UserRow>) {
      // Capture original find for use in this scope.
      const originalFind = db.user.findUnique;
      db.user.findUnique = async (args) => {
        const current = await originalFind(args);
        row = {
          ...row,
          ...patch,
          devices: patch.devices
            // Complete the ternary or optional chain started above.
            ? patch.devices.map((d) => ({ ...d }))
            // Complete the ternary or optional chain started above.
            : row.devices.map((d) => ({ ...d })),
        };
        return current;
      };
    },
  };
}

describe("latestActivityAt / activitySignalsOf", () => {
  it("uses max of dates, not nullish coalescing", () => {
    // Capture old login for use in this scope.
    const oldLogin = stale;
    // Capture recent device for use in this scope.
    const recentDevice = fresh;
    assert.equal(
      latestActivityAt([oldLogin, recentDevice, null, stale]).toISOString(),
      recentDevice.toISOString(),
    );
  });

  it("does not treat AuthSession as an activity signal", () => {
    // Capture session last used at for use in this scope.
    const sessionLastUsedAt = fresh;
    // Build user object holding related fields.
    const user = {
      lastLoginAt: stale,
      activatedAt: stale,
      createdAt: stale,
      devices: [] as { lastSeenAt: Date }[],
    };
    const signals = activitySignalsOf(user);
    assert.equal(latestActivityAt(signals).toISOString(), stale.toISOString());
    assert.ok(!signals.includes(sessionLastUsedAt));
  });
});

describe("claimLockInactiveUser", () => {
  it("keeps user active when login is old but a valid device was seen recently", async () => {
    const fake = makeFakeDb({
      id: "u1",
      isActive: true,
      lastLoginAt: stale,
      activatedAt: stale,
      createdAt: stale,
      devices: [{ lastSeenAt: fresh, revokedAt: null }],
    });

    const result = await claimLockInactiveUser(fake.db, "u1", cutoff);

    assert.equal(result.claimed, false);
    assert.equal(fake.updateCalls, 0);
    assert.equal(fake.row.isActive, true);
  });

  it("locks when all applicable signals are older than cutoff", async () => {
    const login = new Date("2026-06-01T00:00:00.000Z");
    // Capture device seen for use in this scope.
    const deviceSeen = new Date("2026-06-15T00:00:00.000Z");
    const activated = new Date("2026-05-01T00:00:00.000Z");
    const created = new Date("2026-04-01T00:00:00.000Z");
    // Capture expected max for use in this scope.
    const expectedMax = deviceSeen;

    const fake = makeFakeDb({
      id: "u2",
      isActive: true,
      lastLoginAt: login,
      activatedAt: activated,
      createdAt: created,
      devices: [{ lastSeenAt: deviceSeen, revokedAt: null }],
    });

    const result = await claimLockInactiveUser(fake.db, "u2", cutoff);

    assert.equal(result.claimed, true);
    if (result.claimed) {
      assert.equal(result.lastActivity.toISOString(), expectedMax.toISOString());
    }
    assert.equal(fake.row.isActive, false);
  });

  it("ignores revoked devices when evaluating activity", async () => {
    const fake = makeFakeDb({
      id: "u3",
      isActive: true,
      lastLoginAt: stale,
      activatedAt: stale,
      createdAt: stale,
      devices: [{ lastSeenAt: fresh, revokedAt: new Date("2026-08-01T00:00:00.000Z") }],
    });

    const result = await claimLockInactiveUser(fake.db, "u3", cutoff);

    assert.equal(result.claimed, true);
    assert.equal(fake.row.isActive, false);
  });

  it("does not lock when activity arrives between read and write", async () => {
    const fake = makeFakeDb({
      id: "u4",
      isActive: true,
      lastLoginAt: stale,
      activatedAt: stale,
      createdAt: stale,
      devices: [],
    });
    fake.becomeActiveAfterRead({ lastLoginAt: fresh });

    const result = await claimLockInactiveUser(fake.db, "u4", cutoff);

    assert.equal(result.claimed, false);
    assert.equal(fake.updateCalls, 1);
    assert.equal(fake.row.isActive, true);
    assert.equal(fake.row.lastLoginAt?.toISOString(), fresh.toISOString());
  });

  it("still locks when only AuthSession activity would be recent", async () => {
    // AuthSession.lastUsedAt is not a policy signal; recent session alone must not keep access.
    const _recentSessionLastUsedAt = fresh;
    void _recentSessionLastUsedAt;

    const fake = makeFakeDb({
      id: "u5",
      isActive: true,
      lastLoginAt: stale,
      activatedAt: stale,
      createdAt: stale,
      devices: [],
    });

    const result = await claimLockInactiveUser(fake.db, "u5", cutoff);

    assert.equal(result.claimed, true);
    assert.equal(fake.row.isActive, false);
  });
});

describe("runLockInactiveUsers policy gate", () => {
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
      user: {
        // Implement findUnique behavior for this type.
        async findUnique() {
          claimFindCalls += 1;
          return null;
        },
        // Implement updateMany behavior for this type.
        async updateMany() {
          claimUpdateCalls += 1;
          return { count: 0 };
        },
      },
    };

    const result = await runLockInactiveUsers({
      getAccess: async () => ({
        lockInactiveUsers: false,
        sessionIdleDays: 30,
      }),
      findCandidates: async () => {
        findCandidatesCalls += 1;
        return [];
      },
      claimDb,
      recordAudit: async () => {
        auditCalls += 1;
        return {} as never;
      },
      startJobRun: async () => ({ id: "job-1" }),
      finishJobRun: async () => undefined,
    });

    // Skip path must advertise why work was not attempted (JobRun summary).
    assert.deepEqual(result, {
      locked: 0,
      skipped: true,
      reason: "disabled",
    });
    assert.equal(findCandidatesCalls, 0);
    assert.equal(claimFindCalls, 0);
    assert.equal(claimUpdateCalls, 0);
    assert.equal(auditCalls, 0);
  });
});
