/**
 * Live SSE: issue short-lived stream tickets and open /events/stream.
 * Every delivery reloads session and scope; heartbeats close idle revoked streams.
 */
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import {
  authenticateToken,
  type AuthUser,
} from "../middleware/auth";
import { getJwtSecret } from "../auth/tokens";
import { subscribe, type LiveEvent } from "../events/bus";
import { resolveDataScope, type DataScope } from "../services/dataScope";
import { assertSessionActive } from "../services/authSessions";
import {
  authorizeLiveDelivery,
  refreshLiveSubscriberState,
} from "../services/liveAuthorization";

/** JWT purpose claim that marks an SSE ticket (not a session access token). */
const SSE_TICKET_PURPOSE = "sse" as const;
/** SSE ticket lifetime (seconds). */
const SSE_TICKET_EXPIRES_SEC = 5 * 60;
/** Heartbeat interval; also refreshes session + DataScope. */
const SSE_HEARTBEAT_MS = 25_000;

type SseTicketPayload = {
  purpose: typeof SSE_TICKET_PURPOSE;
  userId: string;
  employeeId: string;
  role: Role;
  email: string;
  sid: string;
};

/** Type guard for decoded SSE ticket JWT claims. */
function isSseTicketPayload(value: unknown): value is SseTicketPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.purpose === SSE_TICKET_PURPOSE &&
    typeof v.userId === "string" &&
    typeof v.employeeId === "string" &&
    typeof v.role === "string" &&
    typeof v.email === "string" &&
    typeof v.sid === "string"
  );
}

type AssertSessionActive = typeof assertSessionActive;

/**
 * Resolve an SSE ticket JWT to AuthUser using the active AuthSession / DB role.
 * JWT role/email/employeeId claims are ignored for authorization.
 * Exported for unit tests.
 */
export async function resolveSseTicketUser(
  ticket: string,
  assertActive: AssertSessionActive = assertSessionActive,
): Promise<AuthUser | null> {
  try {
    // Verify signature/expiry of the short-lived SSE ticket.
    const decoded = jwt.verify(ticket, getJwtSecret());
    if (!isSseTicketPayload(decoded)) return null;
    // Reload session + user from DB (do not trust JWT role claims).
    const session = await assertActive(decoded.sid, decoded.userId);
    return authUserFromSession(session);
  } catch {
    return null;
  }
}

/** Session access token via Authorization: Bearer (preferred). */
async function authenticateBearer(req: Request): Promise<AuthUser | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  try {
    // Reject SSE tickets presented as Bearer — they belong in ?ticket=
    const peek = jwt.decode(token);
    if (
      peek &&
      typeof peek === "object" &&
      (peek as { purpose?: unknown }).purpose === SSE_TICKET_PURPOSE
    ) {
      return null;
    }
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
      const peek = jwt.decode(cookieToken);
      if (
        peek &&
        typeof peek === "object" &&
        (peek as { purpose?: unknown }).purpose === SSE_TICKET_PURPOSE
      ) {
        return null;
      }
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

/** Map AuthSession (+ user) to the AuthUser shape used elsewhere. */
function authUserFromSession(
  session: Awaited<ReturnType<AssertSessionActive>>,
): AuthUser {
  return {
    userId: session.user.id,
    employeeId: session.user.employeeId,
    role: session.user.role,
    email: session.user.email,
    sid: session.id,
  };
}

/** Thrown when heartbeat DataScope refresh fails (stream should revoke). */
export class SseScopeRefreshError extends Error {
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
      console.error("resolveDataScope failed on SSE heartbeat", err);
      throw new SseScopeRefreshError();
    }
  }
  const assertActive = deps.assertActive ?? assertSessionActive;
  const resolveScope = deps.resolveScope ?? resolveDataScope;
  // Revoked/expired sessions throw and close the stream.
  const session = await assertActive(currentUser.sid, currentUser.userId);
  const next = authUserFromSession(session);
  try {
    // Always re-resolve so sector membership changes apply live.
    const scope = await resolveScope(next);
    return { currentUser: next, scope };
  } catch (err) {
    console.error("resolveDataScope failed on SSE heartbeat", err);
    throw new SseScopeRefreshError();
  }
}

/** Issue a short-lived JWT for EventSource clients that cannot send cookies/headers. */
export function issueTicket(req: Request, res: Response) {
  const user = req.user!;
  const payload: SseTicketPayload = {
    purpose: SSE_TICKET_PURPOSE,
    userId: user.userId,
    employeeId: user.employeeId,
    role: user.role,
    email: user.email,
    sid: user.sid,
  };
  const token = jwt.sign(payload, getJwtSecret(), {
    expiresIn: SSE_TICKET_EXPIRES_SEC,
  });
  res.json({ token, expiresIn: SSE_TICKET_EXPIRES_SEC });
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
    console.error("resolveDataScope failed for SSE", err);
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
    if (heartbeat !== undefined) clearInterval(heartbeat);
    unsubscribe();
  };

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
