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
 * Guard / noop / before are evaluated on the row locked inside the transaction
 * so concurrent identical transitions produce a single audit + afterCommit.
 */
export async function applyLocationChange(opts: ApplyLocationChangeOpts) {
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "Location" WHERE id = ${opts.id} FOR UPDATE
    `;
    const existing = await tx.location.findUnique({ where: { id: opts.id } });
    if (!existing) {
      throw new AppError(404, "not_found", "Location not found");
    }
    opts.guard?.(existing);
    if (opts.isNoop(existing)) {
      const full = await tx.location.findUniqueOrThrow({
        where: { id: opts.id },
        include: locationInclude,
      });
      return { updated: full, changed: false as const };
    }

    const beforeVal =
      opts.beforeValue?.(existing) ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic audit field key
      (existing as any)[opts.field];

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
    return { updated: row, changed: true as const };
  });

  if (outcome.changed) {
    publish("location.changed", { locationId: outcome.updated.id });
    await opts.afterCommit?.(outcome.updated);
  }
  return outcome.updated;
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
