/**
 * Live SSE: issue short-lived stream tickets and open /events/stream.
 * Every delivery reloads session and scope; heartbeats close idle revoked streams.
 */
import type { Request, Response } from "express";
import {
  authenticateToken,
  type AuthUser,
} from "../middleware/auth";
import {
  isSsePurposeToken,
  resolveSseTicketUser,
  signSseTicket,
} from "../auth/sseTickets";
import { subscribe, type LiveEvent } from "../events/bus";
import { sseOpened, sseClosed, sseDeliveryFailed, safeErrorMessage, log } from "../observability";
import { resolveDataScope, type DataScope } from "../services/dataScope";
import {
  authorizeLiveDelivery,
} from "../services/liveAuthorization";
import {
  refreshSseSubscriberState,
  SseScopeRefreshError,
} from "../services/events/sseRefresh";

/** Heartbeat interval; also refreshes session + DataScope. */
const SSE_HEARTBEAT_MS = 25_000;
const activeStreams = new Set<() => void>();

/** Close active streams during process drain; each remains authorization-scoped. */
export function closeSseStreams() {
  for (const close of [...activeStreams]) close();
}

// Re-export for existing unit tests.
export { resolveSseTicketUser } from "../auth/sseTickets";
export {
  refreshSseSubscriberState,
  SseScopeRefreshError,
} from "../services/events/sseRefresh";

/** Session access token via Authorization: Bearer (preferred). */
async function authenticateBearer(req: Request): Promise<AuthUser | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  try {
    // Reject SSE tickets presented as Bearer — they belong in ?ticket=
    if (isSsePurposeToken(token)) return null;
    return await authenticateToken(token);
  } catch {
    return null;
  }
}

/** Short-lived stream ticket via ?ticket= (EventSource-compatible). */
async function authenticateTicket(req: Request): Promise<AuthUser | null> {
  const ticket =
    typeof req.query.ticket === "string" ? req.query.ticket : null;
  if (!ticket) return null;
  return resolveSseTicketUser(ticket);
}

/**
 * Auth order for /stream: Bearer access → session cookie → ?ticket=.
 * SSE-purpose JWTs are rejected as Bearer/cookie so tickets stay query-only.
 */
async function authenticateStream(req: Request): Promise<AuthUser | null> {
  const viaBearer = await authenticateBearer(req);
  if (viaBearer) return viaBearer;

  // httpOnly session cookie (same-origin / credentialed fetch stream)
  const cookieToken =
    typeof req.cookies?.session === "string" ? req.cookies.session : null;
  if (cookieToken) {
    try {
      // Same SSE-ticket rejection as Bearer.
      if (isSsePurposeToken(cookieToken)) return null;
      return await authenticateToken(cookieToken);
    } catch {
      /* fall through */
    }
  }

  return authenticateTicket(req);
}

/** Write one SSE event frame (event name + JSON data). */
function writeSse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** Issue a short-lived JWT for EventSource clients that cannot send cookies/headers. */
export function issueTicket(req: Request, res: Response) {
  const issued = signSseTicket(req.user!);
  res.json(issued);
}

/**
 * Open an SSE connection. Auth order: Bearer access → session cookie → ?ticket=.
 * SSE-purpose JWTs are rejected as Bearer/cookie so tickets stay query-only.
 */
export async function stream(req: Request, res: Response) {
  // Authenticate without requireAuth middleware (EventSource limitations).
  const user = await authenticateStream(req);
  if (!user) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Missing or invalid token",
    });
  }

  let currentUser = user;
  let scope: DataScope;
  try {
    scope = await resolveDataScope(currentUser);
  } catch (err) {
    log.error("sse_initial_scope_failed", { error: safeErrorMessage(err) });
    return res.status(500).json({
      error: "internal",
      message: "Failed to resolve data scope",
    });
  }

  // SSE response headers (disable proxy buffering).
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  // Initial connected event so the client knows the stream is live.
  writeSse(res, "connected", {
    ok: true,
    userId: currentUser.userId,
    at: new Date().toISOString(),
  });

  let closed = false;
  sseOpened();
  // Serialize delivery and heartbeat checks. An older asynchronous refresh must
  // never overwrite a newer authorization decision or write after revocation.
  let pending: Promise<void> = Promise.resolve();
  const enqueue = (action: () => Promise<void>) => {
    pending = pending.then(async () => {
      if (closed) return;
      try {
        await action();
      } catch (err) {
        if (closed) return;
        sseDeliveryFailed();
        writeSse(res, "revoked", {
          ok: false,
          reason: err instanceof SseScopeRefreshError
            ? "scope_refresh_failed"
            : "session_revoked",
        });
        cleanup();
        res.end();
      }
    });
  };
  // Reload only on a live event or idle heartbeat; no polling at a shorter TTL
  // and no authorization cache whose expiry could leak revoked-sector events.
  const onLive = (event: LiveEvent) => {
    if (closed) return;
    enqueue(async () => {
      const authorized = await authorizeLiveDelivery(currentUser, event, (live) => {
        if (!closed) writeSse(res, live.type, live);
      });
      currentUser = authorized.user;
      scope = authorized.scope;
      if (closed) return;
    });
  };
  const unsubscribe = subscribe(onLive);

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    activeStreams.delete(shutdownClose);
    sseClosed();
    if (heartbeat !== undefined) clearInterval(heartbeat);
    unsubscribe();
  };
  const shutdownClose = () => {
    if (closed) return;
    writeSse(res, "shutdown", { reconnect: true });
    cleanup();
    res.end();
  };
  activeStreams.add(shutdownClose);

  // Periodic ping + session/scope refresh.
  heartbeat = setInterval(() => {
    if (closed) return;
    enqueue(async () => {
      // Always re-resolve scope: sector membership can change without
      // role/employeeId/email changing (revoked or newly granted sectors).
      const refreshed = await refreshSseSubscriberState(currentUser);
      currentUser = refreshed.currentUser;
      scope = refreshed.scope;
      if (closed) return;
      res.write(`: ping ${Date.now()}\n\n`);
    });
  }, SSE_HEARTBEAT_MS);

  // Client disconnect / transport error → unsubscribe and stop heartbeat.
  req.on("close", cleanup);
  req.on("error", cleanup);
  return undefined;
}
