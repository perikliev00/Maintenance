/**
 * People directory, invitations, lifecycle, and device helpers.
 * `redeemInvitation` is unauthenticated (sets cookies + user cache like login).
 */
import type { AuthUser, Role } from "./capabilities";
// Import dependency used by this module.
import { API_BASE, apiGet, apiPatch, apiPost, buildQuery, parseJson } from "./http";

// Export type alias for consumers.
export type PersonStatus =
  // Union/intersection type member.
  | "not_activated"
  // Union/intersection type member.
  | "active"
  // Union/intersection type member.
  | "blocked"
  // Union/intersection type member.
  | "archived";

// Export type alias for consumers.
export type Person = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  employeeId: string;
  // Field/property in this shape.
  userId: string | null;
  // Field/property in this shape.
  fullName: string;
  // Field/property in this shape.
  employeeNumber: string;
  // Field/property in this shape.
  email: string | null;
  // Field/property in this shape.
  role: Role | null;
  // Field/property in this shape.
  department: string | null;
  // Field/property in this shape.
  isActive: boolean;
  // Field/property in this shape.
  onboarded: boolean;
  // Field/property in this shape.
  status: PersonStatus;
  // Field/property in this shape.
  archivedAt: string | null;
  /** Optimistic concurrency token for access-state mutations. */
  accessVersion: number;
  // Field/property in this shape.
  deviceCount: number;
  // Field/property in this shape.
  createdAt: string;
};

// Export type alias for consumers.
export type RegisteredDevice = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  label: string;
  // Field/property in this shape.
  employeeId: string;
  // Field/property in this shape.
  userId: string;
  // Field/property in this shape.
  fullName: string;
  // Field/property in this shape.
  employeeNumber: string;
  // Field/property in this shape.
  email: string;
  // Field/property in this shape.
  role: string;
  // Field/property in this shape.
  activatedAt: string;
  // Field/property in this shape.
  lastSeenAt: string;
};

// Export type alias for consumers.
export type Invitation = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  codeHint: string;
  // Field/property in this shape.
  employeeId: string;
  // Field/property in this shape.
  fullName: string;
  // Field/property in this shape.
  employeeNumber: string;
  // Field/property in this shape.
  role: Role;
  // Field/property in this shape.
  email: string;
  // Field/property in this shape.
  status: "issued" | "consumed" | "expired" | "revoked";
  // Field/property in this shape.
  expiresAt: string;
  // Field/property in this shape.
  createdAt: string;
  // Field/property in this shape.
  consumedAt: string | null;
  // Field/property in this shape.
  revokedAt: string | null;
  // Field/property in this shape.
  createdBy: { id: string; email: string; fullName: string };
};

// Export type alias for consumers.
export type IssuedInvitation = {
  // Field/property in this shape.
  invitation: Invitation;
  // Field/property in this shape.
  code: string;
  // Field/property in this shape.
  expiresAt: string;
};

/** Paginated people directory page (when `limit` is passed to fetchPeoplePage). */
export type PeoplePage = {
  // Field/property in this shape.
  items: Person[];
  // Field/property in this shape.
  nextCursor: string | null;
};

/** Active housekeepers for assignment pickers (abortable). */
export async function fetchHousekeepers(init?: { signal?: AbortSignal }) {
  // Return computed result to caller.
  return apiGet<Array<{ id: string; fullName: string; employeeNumber: string }>>(
    // Continue multi-line list/arguments.
    "/cleaning/employees/housekeepers",
    // List item in import/export/params.
    init,
  );
}

/** People directory with optional search, role, and onboarding filters. */
export async function fetchPeople(
  // Field/property in this shape.
  params?: {
    // Field/property in this shape.
    q?: string;
    // Field/property in this shape.
    role?: string;
    // Field/property in this shape.
    includeInactive?: boolean;
    // Field/property in this shape.
    includeArchived?: boolean;
    // Field/property in this shape.
    notOnboarded?: boolean;
  },
  // Field/property in this shape.
  init?: { signal?: AbortSignal },
// Open multi-line construct.
): Promise<Person[]> {
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/people${buildQuery({
      // Field/property in this shape.
      q: params?.q,
      // Field/property in this shape.
      role: params?.role,
      // Field/property in this shape.
      includeInactive: params?.includeInactive || undefined,
      // Field/property in this shape.
      includeArchived: params?.includeArchived || undefined,
      // Field/property in this shape.
      notOnboarded: params?.notOnboarded || undefined,
    // Continue multi-line list/arguments.
    })}`,
    // List item in import/export/params.
    init,
  );
}

/**
 * Paginated people directory. Pass `limit` so the API returns `{ items, nextCursor }`.
 * Used by Team Directory / Existing picker so search stays server-side.
 */
export async function fetchPeoplePage(
  // Field/property in this shape.
  params?: {
    // Field/property in this shape.
    q?: string;
    // Field/property in this shape.
    role?: string;
    // Field/property in this shape.
    includeInactive?: boolean;
    // Field/property in this shape.
    includeArchived?: boolean;
    // Field/property in this shape.
    notOnboarded?: boolean;
    // Field/property in this shape.
    limit?: number;
    // Field/property in this shape.
    cursor?: string;
  },
  // Field/property in this shape.
  init?: { signal?: AbortSignal },
// Open multi-line construct.
): Promise<PeoplePage> {
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/people${buildQuery({
      // Field/property in this shape.
      q: params?.q,
      // Field/property in this shape.
      role: params?.role,
      // Field/property in this shape.
      includeInactive: params?.includeInactive || undefined,
      // Field/property in this shape.
      includeArchived: params?.includeArchived || undefined,
      // Field/property in this shape.
      notOnboarded: params?.notOnboarded || undefined,
      // Field/property in this shape.
      limit: params?.limit ?? 50,
      // Field/property in this shape.
      cursor: params?.cursor,
    // Continue multi-line list/arguments.
    })}`,
    // List item in import/export/params.
    init,
  );
}

// Function definition.
async function postLifecycle(
  // Field/property in this shape.
  employeeId: string,
  // Field/property in this shape.
  action: "block" | "unblock" | "archive" | "restore",
  // Field/property in this shape.
  expectedStatus: PersonStatus,
  // Field/property in this shape.
  accessVersion: number,
// Open multi-line construct.
): Promise<Person> {
  // Return computed result to caller.
  return apiPost(`/people/${employeeId}/${action}`, { expectedStatus, accessVersion });
}

// Exported function entry point.
export function blockPerson(
  // Field/property in this shape.
  employeeId: string,
  // Field/property in this shape.
  expectedStatus: PersonStatus,
  // Field/property in this shape.
  accessVersion: number,
// Open multi-line construct.
) {
  // Return computed result to caller.
  return postLifecycle(employeeId, "block", expectedStatus, accessVersion);
}

// Exported function entry point.
export function unblockPerson(
  // Field/property in this shape.
  employeeId: string,
  // Field/property in this shape.
  expectedStatus: PersonStatus,
  // Field/property in this shape.
  accessVersion: number,
// Open multi-line construct.
) {
  // Return computed result to caller.
  return postLifecycle(employeeId, "unblock", expectedStatus, accessVersion);
}

// Exported function entry point.
export function archivePerson(
  // Field/property in this shape.
  employeeId: string,
  // Field/property in this shape.
  expectedStatus: PersonStatus,
  // Field/property in this shape.
  accessVersion: number,
// Open multi-line construct.
) {
  // Return computed result to caller.
  return postLifecycle(employeeId, "archive", expectedStatus, accessVersion);
}

// Exported function entry point.
export function restorePerson(
  // Field/property in this shape.
  employeeId: string,
  // Field/property in this shape.
  expectedStatus: PersonStatus,
  // Field/property in this shape.
  accessVersion: number,
// Open multi-line construct.
) {
  // Return computed result to caller.
  return postLifecycle(employeeId, "restore", expectedStatus, accessVersion);
}

/** Registered (non-revoked) devices for an employee. */
export async function fetchEmployeeDevices(
  // Field/property in this shape.
  employeeId: string,
  // Field/property in this shape.
  init?: { signal?: AbortSignal },
// Open multi-line construct.
): Promise<RegisteredDevice[]> {
  // Return computed result to caller.
  return apiGet(`/devices${buildQuery({ employeeId })}`, init);
}

/** Revoke a device registration (does not block the whole employee). */
export async function revokeEmployeeDevice(
  // Field/property in this shape.
  deviceId: string,
// Open multi-line construct.
): Promise<{ id: string; revokedAt: string; revokedOwnDevice: boolean }> {
  // Return computed result to caller.
  return apiPost(`/devices/${deviceId}/revoke`);
}

/** Change a user's role (owner-gated on the server). */
export async function updatePersonRole(userId: string, role: Role): Promise<Person> {
  // Return computed result to caller.
  return apiPatch(`/people/${userId}/role`, { role });
}

/**
 * Issue an invite for a new hire (`kind: "new"`) or an existing employee row
 * (`kind: "existing"`). Returns the one-time code (shown once).
 */
export async function issueInvitation(
  // Field/property in this shape.
  body:
    // Union/intersection type member.
    | {
        // Field/property in this shape.
        kind: "new";
        // Field/property in this shape.
        fullName: string;
        // Field/property in this shape.
        employeeNumber: string;
        // Field/property in this shape.
        email: string;
        // Field/property in this shape.
        role: Role;
        // Field/property in this shape.
        department?: string | null;
      }
    // Union/intersection type member.
    | {
        // Field/property in this shape.
        kind: "existing";
        // Field/property in this shape.
        employeeId: string;
        // Field/property in this shape.
        email?: string;
        // Field/property in this shape.
        role?: Role;
      },
// Open multi-line construct.
): Promise<IssuedInvitation> {
  // Return computed result to caller.
  return apiPost("/invitations", body);
}

/** List invitation rows (codes are hinted, not fully revealed after issue). */
export async function fetchInvitations(): Promise<Invitation[]> {
  // Return computed result to caller.
  return apiGet("/invitations");
}

/** Revoke an unused invitation so the code can no longer be redeemed. */
export async function revokeInvitation(id: string): Promise<Invitation> {
  // Return computed result to caller.
  return apiPost(`/invitations/${id}/revoke`);
}

/**
 * Activate an invite code. Uses raw `fetch` (no refresh retry) because there is
 * no prior session; persists the returned user like `login`.
 */
export async function redeemInvitation(body: {
  // Field/property in this shape.
  code: string;
  // Field/property in this shape.
  password?: string;
  // Field/property in this shape.
  deviceLabel: string;
  // Field/property in this shape.
  fingerprint: string;
// Open multi-line construct.
}): Promise<{ user: AuthUser }> {
  // Local constant binding.
  const res = await fetch(`${API_BASE}/invitations/redeem`, {
    // Field/property in this shape.
    method: "POST",
    // Field/property in this shape.
    credentials: "include",
    // Field/property in this shape.
    headers: { "Content-Type": "application/json" },
    // Field/property in this shape.
    body: JSON.stringify(body),
  });
  // Local constant binding.
  const data = await parseJson<{ user: AuthUser }>(res);
  // Invoke helper or pass arguments.
  localStorage.setItem("user", JSON.stringify(data.user));
  // Return computed result to caller.
  return data;
}

/** Stable per-browser id sent with invite redeem for device binding. */
export function deviceFingerprint(): string {
  // Local constant binding.
  const key = "device_fingerprint";
  // Local constant binding.
  const existing = localStorage.getItem(key);
  // Conditional branch for this case.
  if (existing) return existing;
  // Local constant binding.
  const next = `web-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  // Invoke helper or pass arguments.
  localStorage.setItem(key, next);
  // Return computed result to caller.
  return next;
}
