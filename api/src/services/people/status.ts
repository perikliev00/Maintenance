/**
 * Canonical person lifecycle status for Team / people APIs.
 * All screens must use `derivePersonStatus` — do not reinterpret fields ad hoc.
 */
import type { Role } from "@prisma/client";

export const PERSON_STATUSES = [
  "not_activated",
  "active",
  "blocked",
  "archived",
] as const;

export type PersonStatus = (typeof PERSON_STATUSES)[number];

export type PersonStatusSource = {
  archivedAt: Date | null;
  user: {
    id: string;
    email: string;
    role: Role;
    isActive: boolean;
    activatedAt: Date | null;
    createdAt: Date;
  } | null;
};

/** Derive the single lifecycle status from Employee + optional User. */
export function derivePersonStatus(source: PersonStatusSource): PersonStatus {
  if (source.archivedAt) return "archived";
  if (!source.user) return "not_activated";
  if (!source.user.isActive) return "blocked";
  if (!source.user.activatedAt) return "not_activated";
  return "active";
}

export type PersonDto = {
  id: string;
  employeeId: string;
  userId: string | null;
  fullName: string;
  employeeNumber: string;
  email: string | null;
  role: Role | null;
  department: string | null;
  /** Legacy: false when blocked or archived with inactive user. */
  isActive: boolean;
  onboarded: boolean;
  status: PersonStatus;
  archivedAt: string | null;
  /** Optimistic concurrency token for access-state mutations. */
  accessVersion: number;
  deviceCount: number;
  createdAt: string;
};

/** Map Employee (+ optional User) + device count to the people DTO. */
export function mapPersonDto(e: {
  id: string;
  fullName: string;
  employeeNumber: string;
  department: string | null;
  archivedAt: Date | null;
  accessVersion?: number;
  createdAt: Date;
  user: PersonStatusSource["user"];
  _count: { devices: number };
}): PersonDto {
  const status = derivePersonStatus(e);
  const onboarded = Boolean(e.user?.activatedAt);
  return {
    id: e.id,
    employeeId: e.id,
    userId: e.user?.id ?? null,
    fullName: e.fullName,
    employeeNumber: e.employeeNumber,
    email: e.user?.email ?? null,
    role: e.user?.role ?? null,
    department: e.department,
    // Keep isActive compatible: placeholders without a user stay "active" placeholders.
    isActive: e.user ? e.user.isActive && !e.archivedAt : !e.archivedAt,
    onboarded,
    status,
    archivedAt: e.archivedAt ? e.archivedAt.toISOString() : null,
    accessVersion: e.accessVersion ?? 0,
    deviceCount: e._count.devices,
    createdAt: (e.user?.createdAt ?? e.createdAt).toISOString(),
  };
}
