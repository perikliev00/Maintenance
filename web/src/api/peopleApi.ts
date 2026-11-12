/**
 * People directory, invitations, lifecycle, and device helpers.
 * `redeemInvitation` is unauthenticated (sets cookies + user cache like login).
 */
import type { AuthUser, Role } from "./capabilities";
import { API_BASE, apiGet, apiPatch, apiPost, buildQuery, parseJson } from "./http";

export type PersonStatus =
  // Union/intersection type member.
  | "not_activated"
  // Union/intersection type member.
  | "active"
  // Union/intersection type member.
  | "blocked"
  // Union/intersection type member.
  | "archived";

export type Person = {
  id: string;
  employeeId: string;
  userId: string | null;
  fullName: string;
  employeeNumber: string;
  email: string | null;
  role: Role | null;
  department: string | null;
  isActive: boolean;
  onboarded: boolean;
  status: PersonStatus;
  archivedAt: string | null;
  /** Optimistic concurrency token for access-state mutations. */
  accessVersion: number;
  deviceCount: number;
  createdAt: string;
};

export type RegisteredDevice = {
  id: string;
  label: string;
  employeeId: string;
  userId: string;
  fullName: string;
  employeeNumber: string;
  email: string;
  role: string;
  activatedAt: string;
  lastSeenAt: string;
};

export type Invitation = {
  id: string;
  codeHint: string;
  employeeId: string;
  fullName: string;
  employeeNumber: string;
  role: Role;
  email: string;
  status: "issued" | "consumed" | "expired" | "revoked";
  expiresAt: string;
  createdAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
  createdBy: { id: string; email: string; fullName: string };
};

export type IssuedInvitation = {
  invitation: Invitation;
  code: string;
  expiresAt: string;
};

/** Paginated people directory page (when `limit` is passed to fetchPeoplePage). */
export type PeoplePage = {
  items: Person[];
  nextCursor: string | null;
};

/** Active housekeepers for assignment pickers (abortable). */
export async function fetchHousekeepers(init?: { signal?: AbortSignal }) {
  return apiGet<Array<{ id: string; fullName: string; employeeNumber: string }>>(
    "/cleaning/employees/housekeepers",
    init,
  );
}

/** People directory with optional search, role, and onboarding filters. */
export async function fetchPeople(
  params?: {
    q?: string;
    role?: string;
    includeInactive?: boolean;
    includeArchived?: boolean;
    notOnboarded?: boolean;
  },
  init?: { signal?: AbortSignal },
): Promise<Person[]> {
  return apiGet(
    `/people${buildQuery({
      q: params?.q,
      role: params?.role,
      includeInactive: params?.includeInactive || undefined,
      includeArchived: params?.includeArchived || undefined,
      notOnboarded: params?.notOnboarded || undefined,
    })}`,
    init,
  );
}

/**
 * Paginated people directory. Pass `limit` so the API returns `{ items, nextCursor }`.
 * Used by Team Directory / Existing picker so search stays server-side.
 */
export async function fetchPeoplePage(
  params?: {
    q?: string;
    role?: string;
    includeInactive?: boolean;
    includeArchived?: boolean;
    notOnboarded?: boolean;
    limit?: number;
    cursor?: string;
  },
  init?: { signal?: AbortSignal },
): Promise<PeoplePage> {
  return apiGet(
    `/people${buildQuery({
      q: params?.q,
      role: params?.role,
      includeInactive: params?.includeInactive || undefined,
      includeArchived: params?.includeArchived || undefined,
      notOnboarded: params?.notOnboarded || undefined,
      limit: params?.limit ?? 50,
      cursor: params?.cursor,
    })}`,
    init,
  );
}

// Function definition.
async function postLifecycle(
  employeeId: string,
  action: "block" | "unblock" | "archive" | "restore",
  expectedStatus: PersonStatus,
  accessVersion: number,
): Promise<Person> {
  return apiPost(`/people/${employeeId}/${action}`, { expectedStatus, accessVersion });
}

// Exported function entry point.
export function blockPerson(
  employeeId: string,
  expectedStatus: PersonStatus,
  accessVersion: number,
) {
  return postLifecycle(employeeId, "block", expectedStatus, accessVersion);
}

// Exported function entry point.
export function unblockPerson(
  employeeId: string,
  expectedStatus: PersonStatus,
  accessVersion: number,
) {
  return postLifecycle(employeeId, "unblock", expectedStatus, accessVersion);
}

// Exported function entry point.
export function archivePerson(
  employeeId: string,
  expectedStatus: PersonStatus,
  accessVersion: number,
) {
  return postLifecycle(employeeId, "archive", expectedStatus, accessVersion);
}

// Exported function entry point.
export function restorePerson(
  employeeId: string,
  expectedStatus: PersonStatus,
  accessVersion: number,
) {
  return postLifecycle(employeeId, "restore", expectedStatus, accessVersion);
}

/** Registered (non-revoked) devices for an employee. */
export async function fetchEmployeeDevices(
  employeeId: string,
  init?: { signal?: AbortSignal },
): Promise<RegisteredDevice[]> {
  return apiGet(`/devices${buildQuery({ employeeId })}`, init);
}

/** Revoke a device registration (does not block the whole employee). */
export async function revokeEmployeeDevice(
  deviceId: string,
): Promise<{ id: string; revokedAt: string; revokedOwnDevice: boolean }> {
  return apiPost(`/devices/${deviceId}/revoke`);
}

/** Change a user's role (owner-gated on the server). */
export async function updatePersonRole(userId: string, role: Role): Promise<Person> {
  return apiPatch(`/people/${userId}/role`, { role });
}

/**
 * Issue an invite for a new hire (`kind: "new"`) or an existing employee row
 * (`kind: "existing"`). Returns the one-time code (shown once).
 */
export async function issueInvitation(
  body:
    // Union/intersection type member.
    | {
        kind: "new";
        fullName: string;
        employeeNumber: string;
        email: string;
        role: Role;
        department?: string | null;
      }
    // Union/intersection type member.
    | {
        kind: "existing";
        employeeId: string;
        email?: string;
        role?: Role;
      },
): Promise<IssuedInvitation> {
  return apiPost("/invitations", body);
}

/** List invitation rows (codes are hinted, not fully revealed after issue). */
export async function fetchInvitations(): Promise<Invitation[]> {
  return apiGet("/invitations");
}

/** Revoke an unused invitation so the code can no longer be redeemed. */
export async function revokeInvitation(id: string): Promise<Invitation> {
  return apiPost(`/invitations/${id}/revoke`);
}

/**
 * Activate an invite code. Uses raw `fetch` (no refresh retry) because there is
 * no prior session; persists the returned user like `login`.
 */
export async function redeemInvitation(body: {
  code: string;
  password?: string;
  deviceLabel: string;
  fingerprint: string;
}): Promise<{ user: AuthUser }> {
  const res = await fetch(`${API_BASE}/invitations/redeem`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJson<{ user: AuthUser }>(res);
  localStorage.setItem("user", JSON.stringify(data.user));
  return data;
}

/** Stable per-browser id sent with invite redeem for device binding. */
export function deviceFingerprint(): string {
  const key = "device_fingerprint";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const next = `web-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  localStorage.setItem(key, next);
  return next;
}
