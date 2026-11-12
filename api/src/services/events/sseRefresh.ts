/**
 * SSE subscriber heartbeat: refresh AuthSession + DataScope under live locks.
 */
import type { AuthUser } from "../../auth/tokens";
import { authUserFromSession } from "../../auth/sseTickets";
import { log, safeErrorMessage } from "../../observability";
import { resolveDataScope, type DataScope } from "../dataScope";
import { assertSessionActive } from "../authSessions";
import { refreshLiveSubscriberState } from "../liveAuthorization";

// Declare type AssertSessionActive for callers and internals.
type AssertSessionActive = typeof assertSessionActive;

/** Thrown when heartbeat DataScope refresh fails (stream should revoke). */
export class SseScopeRefreshError extends Error {
  // Initialize instance state when constructed.
  constructor(message = "Failed to resolve data scope") {
    super(message);
    this.name = "SseScopeRefreshError";
  }
}

/**
 * Heartbeat refresh under the same User FOR SHARE serialization as delivery.
 * Exported for unit tests; deps remain for legacy stubs that bypass the lock.
 */
export async function refreshSseSubscriberState(
  currentUser: AuthUser,
  deps: {
    assertActive?: AssertSessionActive;
    resolveScope?: typeof resolveDataScope;
  } = {},
): Promise<{ currentUser: AuthUser; scope: DataScope }> {
  // Production path: share the live-authorization lock with writers.
  if (!deps.assertActive && !deps.resolveScope) {
    try {
      const refreshed = await refreshLiveSubscriberState(currentUser);
      return { currentUser: refreshed.user, scope: refreshed.scope };
    } catch (err) {
      if (err instanceof SseScopeRefreshError) throw err;
      // assertSessionActive / resolve failures close the stream as revoked.
      if (
        err &&
        typeof err === "object" &&
        "status" in err &&
        (err as { status?: number }).status === 401
      ) {
        throw err;
      }
      // Record observability detail for operators.
      log.error("sse_scope_refresh_failed", { error: safeErrorMessage(err) });
      throw new SseScopeRefreshError();
    }
  }
  // Capture assert active for use in this scope.
  const assertActive = deps.assertActive ?? assertSessionActive;
  // Capture resolve scope for use in this scope.
  const resolveScope = deps.resolveScope ?? resolveDataScope;
  // Revoked/expired sessions throw and close the stream.
  const session = await assertActive(currentUser.sid, currentUser.userId);
  const next = authUserFromSession(session);
  try {
    // Always re-resolve so sector membership changes apply live.
    const scope = await resolveScope(next);
    return { currentUser: next, scope };
  } catch (err) {
    // Record observability detail for operators.
    log.error("sse_scope_refresh_failed", { error: safeErrorMessage(err) });
    throw new SseScopeRefreshError();
  }
}
