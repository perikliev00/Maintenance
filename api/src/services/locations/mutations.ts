/**
 * Shared single-field location mutations: find → guard/noop → tx update + audit → publish.
 */
import {
  // Run next step: CatalogStatus,
  CatalogStatus,
  // Declare type Location for callers and internals.
  type Location,
  // Declare type Prisma for callers and internals.
  type Prisma,
// Run next step: } from "@prisma/client";
} from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ../../events/bus for this service.
import { publish } from "../../events/bus";
// Import module ../audit for this service.
import { recordAudit } from "../audit";
// Import module ./types for this service.
import { locationInclude } from "./types";

// Declare type LocationRow for callers and internals.
type LocationRow = Prisma.LocationGetPayload<{ include: typeof locationInclude }>;

// Declare type ApplyLocationChangeOpts for callers and internals.
export type ApplyLocationChangeOpts = {
  // Set id on the structure being built.
  id: string;
  // Run next step: actorEmployeeId?: string;
  actorEmployeeId?: string;
  /** Field name recorded in audit before/after snapshots. */
  field: string;
  // Set next on the structure being built.
  next: unknown;
  // Set action on the structure being built.
  action: string;
  // Set data on the structure being built.
  data: Prisma.LocationUpdateInput;
  // Set isNoop on the structure being built.
  isNoop: (existing: Location) => boolean;
  // Set summary on the structure being built.
  summary: (row: LocationRow) => string;
  // Run next step: guard?: (existing: Location) => void;
  guard?: (existing: Location) => void;
  // Run next step: afterCommit?: (updated: LocationRow) => Promise<void> | void…
  afterCommit?: (updated: LocationRow) => Promise<void> | void;
  // Run next step: beforeValue?: (existing: Location) => unknown;
  beforeValue?: (existing: Location) => unknown;
};

/**
 * Apply one audited location field change with idempotent no-op short-circuit.
 * Guard / noop / before are evaluated on the row locked inside the transaction
 * so concurrent identical transitions produce a single audit + afterCommit.
 */
export async function applyLocationChange(opts: ApplyLocationChangeOpts) {
  // Load outcome asynchronously for the next steps.
  const outcome = await prisma.$transaction(async (tx) => {
    // Wait for the async step before continuing.
    await tx.$queryRaw`
      SELECT id FROM "Location" WHERE id = ${opts.id} FOR UPDATE
    `;
    // Load existing asynchronously for the next steps.
    const existing = await tx.location.findUnique({ where: { id: opts.id } });
    // Branch when this condition holds so the right path runs.
    if (!existing) {
      // Abort with an error so callers can react.
      throw new AppError(404, "not_found", "Location not found");
    }
    // Run next step: opts.guard?.(existing);
    opts.guard?.(existing);
    // Branch when this condition holds so the right path runs.
    if (opts.isNoop(existing)) {
      // Load full asynchronously for the next steps.
      const full = await tx.location.findUniqueOrThrow({
        // Set where on the structure being built.
        where: { id: opts.id },
        // Set include on the structure being built.
        include: locationInclude,
      });
      // Return the computed result to the caller.
      return { updated: full, changed: false as const };
    }

    // Capture before val for use in this scope.
    const beforeVal =
      // Run next step: opts.beforeValue?.(existing) ??
      opts.beforeValue?.(existing) ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic audit field key
      (existing as any)[opts.field];

    // Load row asynchronously for the next steps.
    const row = await tx.location.update({
      // Set where on the structure being built.
      where: { id: opts.id },
      // Set data on the structure being built.
      data: opts.data,
      // Set include on the structure being built.
      include: locationInclude,
    });
    // Wait for the async step before continuing.
    await recordAudit(
      // Run next step: {
      {
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: opts.actorEmployeeId,
        // Set action on the structure being built.
        action: opts.action,
        // Set entityType on the structure being built.
        entityType: "location",
        // Set entityId on the structure being built.
        entityId: opts.id,
        // Set locationId on the structure being built.
        locationId: opts.id,
        // Set before on the structure being built.
        before: { [opts.field]: beforeVal },
        // Set after on the structure being built.
        after: { [opts.field]: opts.next },
        // Set summary on the structure being built.
        summary: opts.summary(row),
      },
      // Run next step: tx,
      tx,
    );
    // Return the computed result to the caller.
    return { updated: row, changed: true as const };
  });

  // Branch when this condition holds so the right path runs.
  if (outcome.changed) {
    // Run next step: publish("location.changed", { locationId: outcome.updated.id…
    publish("location.changed", { locationId: outcome.updated.id });
    // Wait for the async step before continuing.
    await opts.afterCommit?.(outcome.updated);
  }
  // Return the computed result to the caller.
  return outcome.updated;
}

/** Soft-archive a location and audit. */
export async function archiveLocation(id: string, actorEmployeeId?: string) {
  // Return the computed result to the caller.
  return applyLocationChange({
    // Run next step: id,
    id,
    // Run next step: actorEmployeeId,
    actorEmployeeId,
    // Set field on the structure being built.
    field: "catalogStatus",
    // Set next on the structure being built.
    next: CatalogStatus.archived,
    // Set action on the structure being built.
    action: "location.archive",
    // Set data on the structure being built.
    data: { catalogStatus: CatalogStatus.archived },
    // Set isNoop on the structure being built.
    isNoop: (existing) => existing.catalogStatus === CatalogStatus.archived,
    // Set summary on the structure being built.
    summary: (row) => `Archived location ${row.number}`,
  });
}

/** Restore an archived location to active and audit. */
export async function restoreLocation(id: string, actorEmployeeId?: string) {
  // Return the computed result to the caller.
  return applyLocationChange({
    // Run next step: id,
    id,
    // Run next step: actorEmployeeId,
    actorEmployeeId,
    // Set field on the structure being built.
    field: "catalogStatus",
    // Set next on the structure being built.
    next: CatalogStatus.active,
    // Set action on the structure being built.
    action: "location.restore",
    // Set data on the structure being built.
    data: { catalogStatus: CatalogStatus.active },
    // Set isNoop on the structure being built.
    isNoop: (existing) => existing.catalogStatus === CatalogStatus.active,
    // Set summary on the structure being built.
    summary: (row) => `Restored location ${row.number}`,
  });
}
