import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Role } from "@prisma/client";
// Continue named import list.
import {
  // Bring refreshSseSubscriberState into scope from the import.
  refreshSseSubscriberState,
  // Bring SseScopeRefreshError into scope from the import.
  SseScopeRefreshError,
} from "./events";
// Import type-only bindings from ../middleware/auth.
import type { AuthUser } from "../middleware/auth";
// Import type-only bindings from ../services/dataScope.
import type { DataScope } from "../services/dataScope";

// Test suite grouping related cases.
describe("refreshSseSubscriberState", () => {
  const user: AuthUser = {
    userId: "u1",
    employeeId: "e1",
    role: Role.supervisor,
    email: "sup@example.com",
    sid: "s1",
  };

  // Single test case asserting expected behavior.
  it("always re-resolves DataScope even when identity fields are unchanged", async () => {
    // Mutable resolveCalls updated as the flow proceeds.
    let resolveCalls = 0;
    const scopeA: DataScope = {
      kind: "sectors",
      sectorIds: ["sec-old"],
      employeeId: "e1",
      role: Role.supervisor,
    };
    const scopeB: DataScope = {
      kind: "sectors",
      sectorIds: ["sec-new"],
      employeeId: "e1",
      role: Role.supervisor,
    };

    const first = await refreshSseSubscriberState(user, {
      assertActive: async () =>
        ({
          id: "s1",
          user: {
            id: "u1",
            employeeId: "e1",
            role: Role.supervisor,
            email: "sup@example.com",
          },
        }) as never,
      resolveScope: async () => {
        resolveCalls += 1;
        // Return value or early exit.
        return resolveCalls === 1 ? scopeA : scopeB;
      },
    });
    assert.deepEqual(first.scope.sectorIds, ["sec-old"]);

    const second = await refreshSseSubscriberState(first.currentUser, {
      assertActive: async () =>
        ({
          id: "s1",
          user: {
            id: "u1",
            employeeId: "e1",
            role: Role.supervisor,
            email: "sup@example.com",
          },
        }) as never,
      resolveScope: async () => {
        resolveCalls += 1;
        // Return value or early exit.
        return resolveCalls === 1 ? scopeA : scopeB;
      },
    });
    assert.equal(resolveCalls, 2);
    assert.deepEqual(second.scope.sectorIds, ["sec-new"]);
  });

  // Single test case asserting expected behavior.
  it("propagates session revocation from assertSessionActive", async () => {
    // Await side-effecting async work.
    await assert.rejects(
      () =>
        refreshSseSubscriberState(user, {
          assertActive: async () => {
            // Abort with an application/HTTP error.
            throw new Error("session revoked");
          },
          resolveScope: async () => {
            // Abort with an application/HTTP error.
            throw new Error("should not resolve scope");
          },
        }),
      /session revoked/,
    );
  });

  // Single test case asserting expected behavior.
  it("throws SseScopeRefreshError when resolveDataScope fails", async () => {
    // Await side-effecting async work.
    await assert.rejects(
      () =>
        refreshSseSubscriberState(user, {
          assertActive: async () =>
            ({
              id: "s1",
              user: {
                id: "u1",
                employeeId: "e1",
                role: Role.supervisor,
                email: "sup@example.com",
              },
            }) as never,
          resolveScope: async () => {
            // Abort with an application/HTTP error.
            throw new Error("db down");
          },
        }),
      (err: unknown) => err instanceof SseScopeRefreshError,
    );
  });
});
