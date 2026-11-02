/**
 * Shared single-field location mutations: find → guard/noop → tx update + audit → publish.
 */
import {
  CatalogStatus,
  type Location,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import { recordAudit } from "../audit";
import { findLocationById } from "./crud";
import { locationInclude } from "./types";

type LocationRow = Prisma.LocationGetPayload<{ include: typeof locationInclude }>;

export type ApplyLocationChangeOpts = {
  id: string;
  actorEmployeeId?: string;
  /** Field name recorded in audit before/after snapshots. */
  field: string;
  next: unknown;
  action: string;
  data: Prisma.LocationUpdateInput;
  isNoop: (existing: Location) => boolean;
  summary: (row: LocationRow) => string;
  guard?: (existing: Location) => void;
  afterCommit?: (updated: LocationRow) => Promise<void> | void;
  beforeValue?: (existing: Location) => unknown;
};

/**
 * Apply one audited location field change with idempotent no-op short-circuit.
 */
export async function applyLocationChange(opts: ApplyLocationChangeOpts) {
  const existing = await prisma.location.findUnique({ where: { id: opts.id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Location not found");
  }
  opts.guard?.(existing);
  if (opts.isNoop(existing)) {
    const full = await findLocationById(opts.id);
    return full!;
  }

  const beforeVal =
    opts.beforeValue?.(existing) ??
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic audit field key
    (existing as any)[opts.field];

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.location.update({
      where: { id: opts.id },
      data: opts.data,
      include: locationInclude,
    });
    await recordAudit(
      {
        actorEmployeeId: opts.actorEmployeeId,
        action: opts.action,
        entityType: "location",
        entityId: opts.id,
        locationId: opts.id,
        before: { [opts.field]: beforeVal },
        after: { [opts.field]: opts.next },
        summary: opts.summary(row),
      },
      tx,
    );
    return row;
  });
  publish("location.changed", { locationId: updated.id });
  await opts.afterCommit?.(updated);
  return updated;
}

/** Soft-archive a location and audit. */
export async function archiveLocation(id: string, actorEmployeeId?: string) {
  return applyLocationChange({
    id,
    actorEmployeeId,
    field: "catalogStatus",
    next: CatalogStatus.archived,
    action: "location.archive",
    data: { catalogStatus: CatalogStatus.archived },
    isNoop: (existing) => existing.catalogStatus === CatalogStatus.archived,
    summary: (row) => `Archived location ${row.number}`,
  });
}

/** Restore an archived location to active and audit. */
export async function restoreLocation(id: string, actorEmployeeId?: string) {
  return applyLocationChange({
    id,
    actorEmployeeId,
    field: "catalogStatus",
    next: CatalogStatus.active,
    action: "location.restore",
    data: { catalogStatus: CatalogStatus.active },
    isNoop: (existing) => existing.catalogStatus === CatalogStatus.active,
    summary: (row) => `Restored location ${row.number}`,
  });
}
