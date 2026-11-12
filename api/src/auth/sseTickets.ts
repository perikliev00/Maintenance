/**
 * Short-lived SSE stream tickets (JWT purpose=sse). Not session access tokens.
 * Authorization always reloads AuthSession / DB role — JWT role claims are ignored.
 */
// jsonwebtoken for signing/verifying short-lived SSE tickets.
import jwt from "jsonwebtoken";
// Role claim type carried on the ticket (ignored for authorization).
import type { Role } from "@prisma/client";
// AuthUser shape returned after session reload.
import type { AuthUser } from "./tokens";
// Shared JWT secret resolver used by access tokens too.
import { getJwtSecret } from "./tokens";
// Ensures the sid on the ticket still maps to an active AuthSession.
import { assertSessionActive } from "../services/authSessions";

/** JWT purpose claim that marks an SSE ticket (not a session access token). */
export const SSE_TICKET_PURPOSE = "sse" as const;
/** SSE ticket lifetime (seconds). */
export const SSE_TICKET_EXPIRES_SEC = 5 * 60;

// Claims embedded in an SSE ticket JWT (role reloaded from DB on resolve).
export type SseTicketPayload = {
  // Provide purpose field used by this structure.
  purpose: typeof SSE_TICKET_PURPOSE;
  // Provide userId field used by this structure.
  userId: string;
  // Provide employeeId field used by this structure.
  employeeId: string;
  // Provide role field used by this structure.
  role: Role;
  // Provide email field used by this structure.
  email: string;
  // Provide sid field used by this structure.
  sid: string;
};

// Injectable assertSessionActive for unit tests.
type AssertSessionActive = typeof assertSessionActive;

/** Type guard for decoded SSE ticket JWT claims. */
export function isSseTicketPayload(value: unknown): value is SseTicketPayload {
  // Conditional branch for the case described by this guard.
  if (!value || typeof value !== "object") return false;
  // Bind v for use in the following logic.
  const v = value as Record<string, unknown>;
  // Return the JSX/UI tree for this render path.
  return (
    // Support the surrounding logic for this step.
    v.purpose === SSE_TICKET_PURPOSE &&
    // Support the surrounding logic for this step.
    typeof v.userId === "string" &&
    // Support the surrounding logic for this step.
    typeof v.employeeId === "string" &&
    // Support the surrounding logic for this step.
    typeof v.role === "string" &&
    // Support the surrounding logic for this step.
    typeof v.email === "string" &&
    // Support the surrounding logic for this step.
    typeof v.sid === "string"
  );
}

/** Map AuthSession (+ user) to the AuthUser shape used elsewhere. */
export function authUserFromSession(
  // Provide session field used by this structure.
  session: Awaited<ReturnType<AssertSessionActive>>,
// Support the surrounding logic for this step.
): AuthUser {
  // Return early result or rendered output from this path.
  return {
    // Provide userId field used by this structure.
    userId: session.user.id,
    // Provide employeeId field used by this structure.
    employeeId: session.user.employeeId,
    // Provide role field used by this structure.
    role: session.user.role,
    // Provide email field used by this structure.
    email: session.user.email,
    // Provide sid field used by this structure.
    sid: session.id,
  };
}

/**
 * Resolve an SSE ticket JWT to AuthUser using the active AuthSession / DB role.
 * JWT role/email/employeeId claims are ignored for authorization.
 */
export async function resolveSseTicketUser(
  // Provide ticket field used by this structure.
  ticket: string,
  // Provide assertActive field used by this structure.
  assertActive: AssertSessionActive = assertSessionActive,
// Support the surrounding logic for this step.
): Promise<AuthUser | null> {
  // Begin guarded block to catch runtime failures.
  try {
    // Verify signature/expiry of the short-lived SSE ticket.
    const decoded = jwt.verify(ticket, getJwtSecret(), {
      // Provide algorithms field used by this structure.
      algorithms: ["HS256"],
    });
    // Conditional branch for the case described by this guard.
    if (!isSseTicketPayload(decoded)) return null;
    // Reload session + user from DB (do not trust JWT role claims).
    const session = await assertActive(decoded.sid, decoded.userId);
    // Return early result or rendered output from this path.
    return authUserFromSession(session);
  // Support the surrounding logic for this step.
  } catch {
    // Return early result or rendered output from this path.
    return null;
  }
}

/** Sign a short-lived SSE ticket for EventSource clients. */
export function signSseTicket(user: AuthUser): {
  // Provide token field used by this structure.
  token: string;
  // Provide expiresIn field used by this structure.
  expiresIn: number;
// Support the surrounding logic for this step.
} {
  // Embed purpose=sse so access-token verify rejects this JWT.
  const payload: SseTicketPayload = {
    // Provide purpose field used by this structure.
    purpose: SSE_TICKET_PURPOSE,
    // Provide userId field used by this structure.
    userId: user.userId,
    // Provide employeeId field used by this structure.
    employeeId: user.employeeId,
    // Provide role field used by this structure.
    role: user.role,
    // Provide email field used by this structure.
    email: user.email,
    // Provide sid field used by this structure.
    sid: user.sid,
  };
  // Bind token for use in the following logic.
  const token = jwt.sign(payload, getJwtSecret(), {
    // Provide expiresIn field used by this structure.
    expiresIn: SSE_TICKET_EXPIRES_SEC,
    // Provide algorithm field used by this structure.
    algorithm: "HS256",
  });
  // Return early result or rendered output from this path.
  return { token, expiresIn: SSE_TICKET_EXPIRES_SEC };
}

/** True when a decoded JWT (or peek) carries the SSE ticket purpose. */
export function isSsePurposeToken(token: string): boolean {
  // decode does not verify — callers use this only as a cheap purpose peek.
  const peek = jwt.decode(token);
  // Return the JSX/UI tree for this render path.
  return (
    // Support the surrounding logic for this step.
    !!peek &&
    // Support the surrounding logic for this step.
    typeof peek === "object" &&
    // Support the surrounding logic for this step.
    (peek as { purpose?: unknown }).purpose === SSE_TICKET_PURPOSE
  );
}
