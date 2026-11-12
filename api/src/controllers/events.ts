/**
 * Live SSE: issue short-lived stream tickets and open /events/stream.
 * Every delivery reloads session and scope; heartbeats close idle revoked streams.
 */
import type { Request, Response } from "express";
// Continue named import list.
import {
  // Bring authenticateToken into scope from the import.
  authenticateToken,
  // Continue the controller logic.
  type AuthUser,
} from "../middleware/auth";
// Continue named import list.
import {
  // Bring isSsePurposeToken into scope from the import.
  isSsePurposeToken,
  // Bring resolveSseTicketUser into scope from the import.
  resolveSseTicketUser,
  // Bring signSseTicket into scope from the import.
  signSseTicket,
} from "../auth/sseTickets";
// Import local module ../events/bus.
import { subscribe, type LiveEvent } from "../events/bus";
// Import local module ../observability.
import { sseOpened, sseClosed, sseDeliveryFailed, safeErrorMessage, log } from "../observability";
// Import local module ../services/dataScope.
import { resolveDataScope, type DataScope } from "../services/dataScope";
// Continue named import list.
import {
  // Bring authorizeLiveDelivery into scope from the import.
  authorizeLiveDelivery,
} from "../services/liveAuthorization";
// Continue named import list.
import {
  // Bring refreshSseSubscriberState into scope from the import.
  refreshSseSubscriberState,
  // Bring SseScopeRefreshError into scope from the import.
  SseScopeRefreshError,
} from "../services/events/sseRefresh";

/** Heartbeat interval; also refreshes session + DataScope. */
const SSE_HEARTBEAT_MS = 25_000;
// Bind activeStreams for use in the handler below.
const activeStreams = new Set<() => void>();

/** Close active streams during process drain; each remains authorization-scoped. */
export function closeSseStreams() {
  // Iterate to process each item.
  for (const close of [...activeStreams]) close();
}

// Re-export for existing unit tests.
export { resolveSseTicketUser } from "../auth/sseTickets";
// Re-export public symbols for consumers.
export {
  // Pass refreshSseSubscriberState through.
  refreshSseSubscriberState,
  // Pass SseScopeRefreshError through.
  SseScopeRefreshError,
} from "../services/events/sseRefresh";

/** Session access token via Authorization: Bearer (preferred). */
async function authenticateBearer(req: Request): Promise<AuthUser | null> {
  // Bind header for use in the handler below.
  const header = req.headers.authorization;
  // Guard: skip or fail when the negated condition holds.
  if (!header?.startsWith("Bearer ")) return null;
  // Bind token for use in the handler below.
  const token = header.slice("Bearer ".length);
  // Try block for operations that may throw.
  try {
    // Reject SSE tickets presented as Bearer — they belong in ?ticket=
    if (isSsePurposeToken(token)) return null;
    // Return value or early exit.
    return await authenticateToken(token);
  // Continue the controller logic.
  } catch {
    // Return value or early exit.
    return null;
  }
}

/** Short-lived stream ticket via ?ticket= (EventSource-compatible). */
async function authenticateTicket(req: Request): Promise<AuthUser | null> {
  // Bind ticket for use in the handler below.
  const ticket =
    // Narrow the runtime type before using the value.
    typeof req.query.ticket === "string" ? req.query.ticket : null;
  // Guard: skip or fail when the negated condition holds.
  if (!ticket) return null;
  // Return value or early exit.
  return resolveSseTicketUser(ticket);
}

/**
 * Auth order for /stream: Bearer access → session cookie → ?ticket=.
 * SSE-purpose JWTs are rejected as Bearer/cookie so tickets stay query-only.
 */
async function authenticateStream(req: Request): Promise<AuthUser | null> {
  // Await async work into viaBearer.
  const viaBearer = await authenticateBearer(req);
  // Branch when this condition holds.
  if (viaBearer) return viaBearer;

  // httpOnly session cookie (same-origin / credentialed fetch stream)
  const cookieToken =
    // Narrow the runtime type before using the value.
    typeof req.cookies?.session === "string" ? req.cookies.session : null;
  // Branch when this condition holds.
  if (cookieToken) {
    // Try block for operations that may throw.
    try {
      // Same SSE-ticket rejection as Bearer.
      if (isSsePurposeToken(cookieToken)) return null;
      // Return value or early exit.
      return await authenticateToken(cookieToken);
    // Continue the controller logic.
    } catch {
      /* fall through */
    }
  }

  // Return value or early exit.
  return authenticateTicket(req);
}

/** Write one SSE event frame (event name + JSON data). */
function writeSse(res: Response, event: string, data: unknown) {
  // Continue the controller logic.
  res.write(`event: ${event}\n`);
  // Continue the controller logic.
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** Issue a short-lived JWT for EventSource clients that cannot send cookies/headers. */
export function issueTicket(req: Request, res: Response) {
  // Bind issued for use in the handler below.
  const issued = signSseTicket(req.user!);
  // Write JSON body for a successful response.
  res.json(issued);
}

/**
 * Open an SSE connection. Auth order: Bearer access → session cookie → ?ticket=.
 * SSE-purpose JWTs are rejected as Bearer/cookie so tickets stay query-only.
 */
export async function stream(req: Request, res: Response) {
  // Authenticate without requireAuth middleware (EventSource limitations).
  const user = await authenticateStream(req);
  // Guard: skip or fail when the negated condition holds.
  if (!user) {
    // Unauthorized when auth is missing or invalid.
    return res.status(401).json({
      // Provide error for the object/call below.
      error: "unauthorized",
      // Provide message for the object/call below.
      message: "Missing or invalid token",
    });
  }

  // Mutable currentUser updated as the flow proceeds.
  let currentUser = user;
  // Continue the controller logic.
  let scope: DataScope;
  // Try block for operations that may throw.
  try {
    // Continue the controller logic.
    scope = await resolveDataScope(currentUser);
  // Continue the controller logic.
  } catch (err) {
    // Continue the controller logic.
    log.error("sse_initial_scope_failed", { error: safeErrorMessage(err) });
    // Send the HTTP response and end the handler.
    return res.status(500).json({
      // Provide error for the object/call below.
      error: "internal",
      // Provide message for the object/call below.
      message: "Failed to resolve data scope",
    });
  }

  // SSE response headers (disable proxy buffering).
  res.setHeader("Content-Type", "text/event-stream");
  // Continue the controller logic.
  res.setHeader("Cache-Control", "no-cache, no-transform");
  // Continue the controller logic.
  res.setHeader("Connection", "keep-alive");
  // Continue the controller logic.
  res.setHeader("X-Accel-Buffering", "no");
  // Branch when this condition holds.
  if (typeof res.flushHeaders === "function") {
    // Continue the controller logic.
    res.flushHeaders();
  }

  // Initial connected event so the client knows the stream is live.
  writeSse(res, "connected", {
    // Provide ok for the object/call below.
    ok: true,
    // Provide userId for the object/call below.
    userId: currentUser.userId,
    // Provide at for the object/call below.
    at: new Date().toISOString(),
  });

  // Mutable closed updated as the flow proceeds.
  let closed = false;
  // Continue the controller logic.
  sseOpened();
  // Serialize delivery and heartbeat checks. An older asynchronous refresh must
  // never overwrite a newer authorization decision or write after revocation.
  let pending: Promise<void> = Promise.resolve();
  // Bind enqueue for use in the handler below.
  const enqueue = (action: () => Promise<void>) => {
    // Continue the controller logic.
    pending = pending.then(async () => {
      // Branch when this condition holds.
      if (closed) return;
      // Try block for operations that may throw.
      try {
        // Await side-effecting async work.
        await action();
      // Continue the controller logic.
      } catch (err) {
        // Branch when this condition holds.
        if (closed) return;
        // Continue the controller logic.
        sseDeliveryFailed();
        // Continue the controller logic.
        writeSse(res, "revoked", {
          // Provide ok for the object/call below.
          ok: false,
          // Provide reason for the object/call below.
          reason: err instanceof SseScopeRefreshError
            // Continue the conditional expression.
            ? "scope_refresh_failed"
            // Continue the conditional expression.
            : "session_revoked",
        });
        // Continue the controller logic.
        cleanup();
        // Continue the controller logic.
        res.end();
      }
    });
  };
  // Reload only on a live event or idle heartbeat; no polling at a shorter TTL
  // and no authorization cache whose expiry could leak revoked-sector events.
  const onLive = (event: LiveEvent) => {
    // Branch when this condition holds.
    if (closed) return;
    // Continue the controller logic.
    enqueue(async () => {
      // Await async work into authorized.
      const authorized = await authorizeLiveDelivery(currentUser, event, (live) => {
        // Guard: skip or fail when the negated condition holds.
        if (!closed) writeSse(res, live.type, live);
      });
      // Continue the controller logic.
      currentUser = authorized.user;
      // Continue the controller logic.
      scope = authorized.scope;
      // Branch when this condition holds.
      if (closed) return;
    });
  };
  // Bind unsubscribe for use in the handler below.
  const unsubscribe = subscribe(onLive);

  // Continue the controller logic.
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  // Bind cleanup for use in the handler below.
  const cleanup = () => {
    // Branch when this condition holds.
    if (closed) return;
    // Continue the controller logic.
    closed = true;
    // Continue the controller logic.
    activeStreams.delete(shutdownClose);
    // Continue the controller logic.
    sseClosed();
    // Branch when this condition holds.
    if (heartbeat !== undefined) clearInterval(heartbeat);
    // Continue the controller logic.
    unsubscribe();
  };
  // Bind shutdownClose for use in the handler below.
  const shutdownClose = () => {
    // Branch when this condition holds.
    if (closed) return;
    // Continue the controller logic.
    writeSse(res, "shutdown", { reconnect: true });
    // Continue the controller logic.
    cleanup();
    // Continue the controller logic.
    res.end();
  };
  // Continue the controller logic.
  activeStreams.add(shutdownClose);

  // Periodic ping + session/scope refresh.
  heartbeat = setInterval(() => {
    // Branch when this condition holds.
    if (closed) return;
    // Continue the controller logic.
    enqueue(async () => {
      // Always re-resolve scope: sector membership can change without
      // role/employeeId/email changing (revoked or newly granted sectors).
      const refreshed = await refreshSseSubscriberState(currentUser);
      // Continue the controller logic.
      currentUser = refreshed.currentUser;
      // Continue the controller logic.
      scope = refreshed.scope;
      // Branch when this condition holds.
      if (closed) return;
      // Continue the controller logic.
      res.write(`: ping ${Date.now()}\n\n`);
    });
  // Continue the controller logic.
  }, SSE_HEARTBEAT_MS);

  // Client disconnect / transport error → unsubscribe and stop heartbeat.
  req.on("close", cleanup);
  // Continue the controller logic.
  req.on("error", cleanup);
  // Return value or early exit.
  return undefined;
}
