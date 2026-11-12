// Import dependency node:assert/strict.
import assert from "node:assert/strict";
// Import dependency node:test.
import { describe, it } from "node:test";
// Import dependency @prisma/client.
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
  // Arrange or act for this test case.
  const user: AuthUser = {
    // Provide userId for the object/call below.
    userId: "u1",
    // Provide employeeId for the object/call below.
    employeeId: "e1",
    // Provide role for the object/call below.
    role: Role.supervisor,
    // Provide email for the object/call below.
    email: "sup@example.com",
    // Provide sid for the object/call below.
    sid: "s1",
  };

  // Single test case asserting expected behavior.
  it("always re-resolves DataScope even when identity fields are unchanged", async () => {
    // Mutable resolveCalls updated as the flow proceeds.
    let resolveCalls = 0;
    // Arrange or act for this test case.
    const scopeA: DataScope = {
      // Provide kind for the object/call below.
      kind: "sectors",
      // Provide sectorIds for the object/call below.
      sectorIds: ["sec-old"],
      // Provide employeeId for the object/call below.
      employeeId: "e1",
      // Provide role for the object/call below.
      role: Role.supervisor,
    };
    // Arrange or act for this test case.
    const scopeB: DataScope = {
      // Provide kind for the object/call below.
      kind: "sectors",
      // Provide sectorIds for the object/call below.
      sectorIds: ["sec-new"],
      // Provide employeeId for the object/call below.
      employeeId: "e1",
      // Provide role for the object/call below.
      role: Role.supervisor,
    };

    // Await async work into first.
    const first = await refreshSseSubscriberState(user, {
      // Arrange or act for this test case.
      assertActive: async () =>
        // Arrange or act for this test case.
        ({
          // Provide id for the object/call below.
          id: "s1",
          // Provide user for the object/call below.
          user: {
            // Provide id for the object/call below.
            id: "u1",
            // Provide employeeId for the object/call below.
            employeeId: "e1",
            // Provide role for the object/call below.
            role: Role.supervisor,
            // Provide email for the object/call below.
            email: "sup@example.com",
          },
        // Arrange or act for this test case.
        }) as never,
      // Arrange or act for this test case.
      resolveScope: async () => {
        // Arrange or act for this test case.
        resolveCalls += 1;
        // Return value or early exit.
        return resolveCalls === 1 ? scopeA : scopeB;
      },
    });
    // Assert expected outcome for this case.
    assert.deepEqual(first.scope.sectorIds, ["sec-old"]);

    // Await async work into second.
    const second = await refreshSseSubscriberState(first.currentUser, {
      // Arrange or act for this test case.
      assertActive: async () =>
        // Arrange or act for this test case.
        ({
          // Provide id for the object/call below.
          id: "s1",
          // Provide user for the object/call below.
          user: {
            // Provide id for the object/call below.
            id: "u1",
            // Provide employeeId for the object/call below.
            employeeId: "e1",
            // Provide role for the object/call below.
            role: Role.supervisor,
            // Provide email for the object/call below.
            email: "sup@example.com",
          },
        // Arrange or act for this test case.
        }) as never,
      // Arrange or act for this test case.
      resolveScope: async () => {
        // Arrange or act for this test case.
        resolveCalls += 1;
        // Return value or early exit.
        return resolveCalls === 1 ? scopeA : scopeB;
      },
    });
    // Assert expected outcome for this case.
    assert.equal(resolveCalls, 2);
    // Assert expected outcome for this case.
    assert.deepEqual(second.scope.sectorIds, ["sec-new"]);
  });

  // Single test case asserting expected behavior.
  it("propagates session revocation from assertSessionActive", async () => {
    // Await side-effecting async work.
    await assert.rejects(
      // Arrange or act for this test case.
      () =>
        // Arrange or act for this test case.
        refreshSseSubscriberState(user, {
          // Arrange or act for this test case.
          assertActive: async () => {
            // Abort with an application/HTTP error.
            throw new Error("session revoked");
          },
          // Arrange or act for this test case.
          resolveScope: async () => {
            // Abort with an application/HTTP error.
            throw new Error("should not resolve scope");
          },
        }),
      // Arrange or act for this test case.
      /session revoked/,
    );
  });

  // Single test case asserting expected behavior.
  it("throws SseScopeRefreshError when resolveDataScope fails", async () => {
    // Await side-effecting async work.
    await assert.rejects(
      // Arrange or act for this test case.
      () =>
        // Arrange or act for this test case.
        refreshSseSubscriberState(user, {
          // Arrange or act for this test case.
          assertActive: async () =>
            // Arrange or act for this test case.
            ({
              // Provide id for the object/call below.
              id: "s1",
              // Provide user for the object/call below.
              user: {
                // Provide id for the object/call below.
                id: "u1",
                // Provide employeeId for the object/call below.
                employeeId: "e1",
                // Provide role for the object/call below.
                role: Role.supervisor,
                // Provide email for the object/call below.
                email: "sup@example.com",
              },
            // Arrange or act for this test case.
            }) as never,
          // Arrange or act for this test case.
          resolveScope: async () => {
            // Abort with an application/HTTP error.
            throw new Error("db down");
          },
        }),
      // Arrange or act for this test case.
      (err: unknown) => err instanceof SseScopeRefreshError,
    );
  });
});
