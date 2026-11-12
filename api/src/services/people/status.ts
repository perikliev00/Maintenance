/**
 * Canonical person lifecycle status for Team / people APIs.
 * All screens must use `derivePersonStatus` — do not reinterpret fields ad hoc.
 */
import type { Role } from "@prisma/client";

// Export PERSON_STATUSES for reuse by other modules.
export const PERSON_STATUSES = [
  // Run next step: "not_activated",
  "not_activated",
  // Run next step: "active",
  "active",
  // Run next step: "blocked",
  "blocked",
  // Run next step: "archived",
  "archived",
// Run next step: ] as const;
] as const;

// Declare type PersonStatus for callers and internals.
export type PersonStatus = (typeof PERSON_STATUSES)[number];

// Declare type PersonStatusSource for callers and internals.
export type PersonStatusSource = {
  // Set archivedAt on the structure being built.
  archivedAt: Date | null;
  // Set user on the structure being built.
  user: {
    // Set id on the structure being built.
    id: string;
    // Set email on the structure being built.
    email: string;
    // Set role on the structure being built.
    role: Role;
    // Set isActive on the structure being built.
    isActive: boolean;
    // Set activatedAt on the structure being built.
    activatedAt: Date | null;
    // Set createdAt on the structure being built.
    createdAt: Date;
  // Run next step: } | null;
  } | null;
};

/** Derive the single lifecycle status from Employee + optional User. */
export function derivePersonStatus(source: PersonStatusSource): PersonStatus {
  // Branch when this condition holds so the right path runs.
  if (source.archivedAt) return "archived";
  // Branch when this condition holds so the right path runs.
  if (!source.user) return "not_activated";
  // Branch when this condition holds so the right path runs.
  if (!source.user.isActive) return "blocked";
  // Branch when this condition holds so the right path runs.
  if (!source.user.activatedAt) return "not_activated";
  // Return the computed result to the caller.
  return "active";
}

// Declare type PersonDto for callers and internals.
export type PersonDto = {
  // Set id on the structure being built.
  id: string;
  // Set employeeId on the structure being built.
  employeeId: string;
  // Set userId on the structure being built.
  userId: string | null;
  // Set fullName on the structure being built.
  fullName: string;
  // Set employeeNumber on the structure being built.
  employeeNumber: string;
  // Set email on the structure being built.
  email: string | null;
  // Set role on the structure being built.
  role: Role | null;
  // Set department on the structure being built.
  department: string | null;
  /** Legacy: false when blocked or archived with inactive user. */
  isActive: boolean;
  // Set onboarded on the structure being built.
  onboarded: boolean;
  // Set status on the structure being built.
  status: PersonStatus;
  // Set archivedAt on the structure being built.
  archivedAt: string | null;
  /** Optimistic concurrency token for access-state mutations. */
  accessVersion: number;
  // Set deviceCount on the structure being built.
  deviceCount: number;
  // Set createdAt on the structure being built.
  createdAt: string;
};

/** Map Employee (+ optional User) + device count to the people DTO. */
export function mapPersonDto(e: {
  // Set id on the structure being built.
  id: string;
  // Set fullName on the structure being built.
  fullName: string;
  // Set employeeNumber on the structure being built.
  employeeNumber: string;
  // Set department on the structure being built.
  department: string | null;
  // Set archivedAt on the structure being built.
  archivedAt: Date | null;
  // Run next step: accessVersion?: number;
  accessVersion?: number;
  // Set createdAt on the structure being built.
  createdAt: Date;
  // Set user on the structure being built.
  user: PersonStatusSource["user"];
  // Set _count on the structure being built.
  _count: { devices: number };
// Run next step: }): PersonDto {
}): PersonDto {
  // Capture status for use in this scope.
  const status = derivePersonStatus(e);
  // Capture onboarded for use in this scope.
  const onboarded = Boolean(e.user?.activatedAt);
  // Return the computed result to the caller.
  return {
    // Set id on the structure being built.
    id: e.id,
    // Set employeeId on the structure being built.
    employeeId: e.id,
    // Set userId on the structure being built.
    userId: e.user?.id ?? null,
    // Set fullName on the structure being built.
    fullName: e.fullName,
    // Set employeeNumber on the structure being built.
    employeeNumber: e.employeeNumber,
    // Set email on the structure being built.
    email: e.user?.email ?? null,
    // Set role on the structure being built.
    role: e.user?.role ?? null,
    // Set department on the structure being built.
    department: e.department,
    // Keep isActive compatible: placeholders without a user stay "active" placeholders.
    isActive: e.user ? e.user.isActive && !e.archivedAt : !e.archivedAt,
    // Run next step: onboarded,
    onboarded,
    // Run next step: status,
    status,
    // Set archivedAt on the structure being built.
    archivedAt: e.archivedAt ? e.archivedAt.toISOString() : null,
    // Set accessVersion on the structure being built.
    accessVersion: e.accessVersion ?? 0,
    // Set deviceCount on the structure being built.
    deviceCount: e._count.devices,
    // Set createdAt on the structure being built.
    createdAt: (e.user?.createdAt ?? e.createdAt).toISOString(),
  };
}
