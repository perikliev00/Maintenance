/**
 * Short-lived SSE stream tickets (JWT purpose=sse). Not session access tokens.
 * Authorization always reloads AuthSession / DB role — JWT role claims are ignored.
 */
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import type { AuthUser } from "./tokens";
import { getJwtSecret } from "./tokens";
import { assertSessionActive } from "../services/authSessions";

/** JWT purpose claim that marks an SSE ticket (not a session access token). */
export const SSE_TICKET_PURPOSE = "sse" as const;
/** SSE ticket lifetime (seconds). */
export const SSE_TICKET_EXPIRES_SEC = 5 * 60;

export type SseTicketPayload = {
  purpose: typeof SSE_TICKET_PURPOSE;
  userId: string;
  employeeId: string;
  role: Role;
  email: string;
  sid: string;
};

type AssertSessionActive = typeof assertSessionActive;

/** Type guard for decoded SSE ticket JWT claims. */
export function isSseTicketPayload(value: unknown): value is SseTicketPayload {
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

/** Map AuthSession (+ user) to the AuthUser shape used elsewhere. */
export function authUserFromSession(
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

/**
 * Resolve an SSE ticket JWT to AuthUser using the active AuthSession / DB role.
 * JWT role/email/employeeId claims are ignored for authorization.
 */
export async function resolveSseTicketUser(
  ticket: string,
  assertActive: AssertSessionActive = assertSessionActive,
): Promise<AuthUser | null> {
  try {
    // Verify signature/expiry of the short-lived SSE ticket.
    const decoded = jwt.verify(ticket, getJwtSecret(), {
      algorithms: ["HS256"],
    });
    if (!isSseTicketPayload(decoded)) return null;
    // Reload session + user from DB (do not trust JWT role claims).
    const session = await assertActive(decoded.sid, decoded.userId);
    return authUserFromSession(session);
  } catch {
    return null;
  }
}

/** Sign a short-lived SSE ticket for EventSource clients. */
export function signSseTicket(user: AuthUser): {
  token: string;
  expiresIn: number;
} {
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
    algorithm: "HS256",
  });
  return { token, expiresIn: SSE_TICKET_EXPIRES_SEC };
}

/** True when a decoded JWT (or peek) carries the SSE ticket purpose. */
export function isSsePurposeToken(token: string): boolean {
  const peek = jwt.decode(token);
  return (
    !!peek &&
    typeof peek === "object" &&
    (peek as { purpose?: unknown }).purpose === SSE_TICKET_PURPOSE
  );
}
