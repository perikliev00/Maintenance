/**
 * SSE subscriber heartbeat: refresh AuthSession + DataScope under live locks.
 */
import type { AuthUser } from "../../auth/tokens";
// Import module ../../auth/sseTickets for this service.
import { authUserFromSession } from "../../auth/sseTickets";
// Import module ../../observability for this service.
import { log, safeErrorMessage } from "../../observability";
// Import module ../dataScope for this service.
import { resolveDataScope, type DataScope } from "../dataScope";
// Import module ../authSessions for this service.
import { assertSessionActive } from "../authSessions";
// Import module ../liveAuthorization for this service.
import { refreshLiveSubscriberState } from "../liveAuthorization";

// Declare type AssertSessionActive for callers and internals.
type AssertSessionActive = typeof assertSessionActive;

/** Thrown when heartbeat DataScope refresh fails (stream should revoke). */
export class SseScopeRefreshError extends Error {
  // Initialize instance state when constructed.
  constructor(message = "Failed to resolve data scope") {
    // Run next step: super(message);
    super(message);
    // Run next step: this.name = "SseScopeRefreshError";
    this.name = "SseScopeRefreshError";
  }
}

/**
 * Heartbeat refresh under the same User FOR SHARE serialization as delivery.
 * Exported for unit tests; deps remain for legacy stubs that bypass the lock.
 */
export async function refreshSseSubscriberState(
  // Set currentUser on the structure being built.
  currentUser: AuthUser,
  // Set deps on the structure being built.
  deps: {
    // Run next step: assertActive?: AssertSessionActive;
    assertActive?: AssertSessionActive;
    // Run next step: resolveScope?: typeof resolveDataScope;
    resolveScope?: typeof resolveDataScope;
  // Run next step: } = {},
  } = {},
// Run next step: ): Promise<{ currentUser: AuthUser; scope: DataScope }> {
): Promise<{ currentUser: AuthUser; scope: DataScope }> {
  // Production path: share the live-authorization lock with writers.
  if (!deps.assertActive && !deps.resolveScope) {
    // Attempt the fallible work so errors can be handled below.
    try {
      // Load refreshed asynchronously for the next steps.
      const refreshed = await refreshLiveSubscriberState(currentUser);
      // Return the computed result to the caller.
      return { currentUser: refreshed.user, scope: refreshed.scope };
    // Run next step: } catch (err) {
    } catch (err) {
      // Branch when this condition holds so the right path runs.
      if (err instanceof SseScopeRefreshError) throw err;
      // assertSessionActive / resolve failures close the stream as revoked.
      if (
        // Run next step: err &&
        err &&
        // Run next step: typeof err === "object" &&
        typeof err === "object" &&
        // Run next step: "status" in err &&
        "status" in err &&
        // Run next step: (err as { status?: number }).status === 401
        (err as { status?: number }).status === 401
      // Run next step: ) {
      ) {
        // Abort with an error so callers can react.
        throw err;
      }
      // Record observability detail for operators.
      log.error("sse_scope_refresh_failed", { error: safeErrorMessage(err) });
      // Abort with an error so callers can react.
      throw new SseScopeRefreshError();
    }
  }
  // Capture assert active for use in this scope.
  const assertActive = deps.assertActive ?? assertSessionActive;
  // Capture resolve scope for use in this scope.
  const resolveScope = deps.resolveScope ?? resolveDataScope;
  // Revoked/expired sessions throw and close the stream.
  const session = await assertActive(currentUser.sid, currentUser.userId);
  // Capture next for use in this scope.
  const next = authUserFromSession(session);
  // Attempt the fallible work so errors can be handled below.
  try {
    // Always re-resolve so sector membership changes apply live.
    const scope = await resolveScope(next);
    // Return the computed result to the caller.
    return { currentUser: next, scope };
  // Run next step: } catch (err) {
  } catch (err) {
    // Record observability detail for operators.
    log.error("sse_scope_refresh_failed", { error: safeErrorMessage(err) });
    // Abort with an error so callers can react.
    throw new SseScopeRefreshError();
  }
}
