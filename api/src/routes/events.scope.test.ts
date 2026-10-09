import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Role } from "@prisma/client";
import {
  refreshSseSubscriberState,
  SseScopeRefreshError,
} from "./events";
import type { AuthUser } from "../middleware/auth";
import type { DataScope } from "../services/dataScope";

describe("refreshSseSubscriberState", () => {
  const user: AuthUser = {
    userId: "u1",
    employeeId: "e1",
    role: Role.supervisor,
    email: "sup@example.com",
    sid: "s1",
  };

  it("always re-resolves DataScope even when identity fields are unchanged", async () => {
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
        return resolveCalls === 1 ? scopeA : scopeB;
      },
    });
    assert.equal(resolveCalls, 2);
    assert.deepEqual(second.scope.sectorIds, ["sec-new"]);
  });

  it("propagates session revocation from assertSessionActive", async () => {
    await assert.rejects(
      () =>
        refreshSseSubscriberState(user, {
          assertActive: async () => {
            throw new Error("session revoked");
          },
          resolveScope: async () => {
            throw new Error("should not resolve scope");
          },
        }),
      /session revoked/,
    );
  });

  it("throws SseScopeRefreshError when resolveDataScope fails", async () => {
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
            throw new Error("db down");
          },
        }),
      (err: unknown) => err instanceof SseScopeRefreshError,
    );
  });
});
