import { Router, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import {
  authenticateToken,
  requireAuth,
  type AuthUser,
} from "../middleware/auth";
import { getJwtSecret } from "../auth/tokens";
import { subscribe, type LiveEvent } from "../events/bus";
import { canDeliverLiveEvent } from "../events/authorizeLiveEvent";
import { resolveDataScope } from "../services/dataScope";

export const eventsRouter = Router();

const SSE_TICKET_PURPOSE = "sse" as const;
const SSE_TICKET_EXPIRES_SEC = 5 * 60;

type SseTicketPayload = {
  purpose: typeof SSE_TICKET_PURPOSE;
  userId: string;
  employeeId: string;
  role: Role;
  email: string;
  sid: string;
};

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
function authenticateTicket(req: Request): AuthUser | null {
  const ticket =
    typeof req.query.ticket === "string" ? req.query.ticket : null;
  if (!ticket) return null;
  try {
    const decoded = jwt.verify(ticket, getJwtSecret());
    if (!isSseTicketPayload(decoded)) return null;
    return {
      userId: decoded.userId,
      employeeId: decoded.employeeId,
      role: decoded.role,
      email: decoded.email,
      sid: decoded.sid,
    };
  } catch {
    return null;
  }
}

async function authenticateStream(req: Request): Promise<AuthUser | null> {
  const viaBearer = await authenticateBearer(req);
  if (viaBearer) return viaBearer;

  // httpOnly session cookie (same-origin / credentialed fetch stream)
  const cookieToken =
    typeof req.cookies?.session === "string" ? req.cookies.session : null;
  if (cookieToken) {
    try {
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

function writeSse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

eventsRouter.post("/ticket", requireAuth, (req, res) => {
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
});

eventsRouter.get("/stream", async (req, res) => {
  const user = await authenticateStream(req);
  if (!user) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Missing or invalid token",
    });
  }

  let scope;
  try {
    scope = await resolveDataScope(user);
  } catch (err) {
    console.error("resolveDataScope failed for SSE", err);
    return res.status(500).json({
      error: "internal",
      message: "Failed to resolve data scope",
    });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  writeSse(res, "connected", {
    ok: true,
    userId: user.userId,
    at: new Date().toISOString(),
  });

  let closed = false;
  const onLive = (event: LiveEvent) => {
    if (closed) return;
    void (async () => {
      try {
        if (!(await canDeliverLiveEvent(scope, event))) return;
        if (closed) return;
        writeSse(res, event.type, event);
      } catch (err) {
        console.error("SSE deliver filter failed", err);
      }
    })();
  };
  const unsubscribe = subscribe(onLive);

  const heartbeat = setInterval(() => {
    if (closed) return;
    res.write(`: ping ${Date.now()}\n\n`);
  }, 25_000);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };

  req.on("close", cleanup);
  req.on("error", cleanup);
  return undefined;
});
