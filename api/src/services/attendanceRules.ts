/**
 * Pure attendance pairing rules: clock-in/out → interval drafts with anomaly
 * flags. Used by rebuild (and unit tests); does not touch the database.
 */
import {
  AttendanceEventKind,
  AttendanceIntervalStatus,
// Support the surrounding control flow.
} from "@prisma/client";
// Runtime import from ../errors.
import { AppError } from "../errors";
// Runtime import from ./hotelTime.
import { hotelDateAsUtcDate } from "./hotelTime";

// Re-export symbols for a stable public API.
export { addDaysYmd } from "./hotelTime";

/** Open intervals older than this without clock-out get `missing_end`. */
export const OPEN_MISSING_END_HOURS = 14;
// Local ABSURD_DURATION_HOURS used below.
const ABSURD_DURATION_HOURS = 16;
// Local LARGE_SKEW_SECONDS used below.
const LARGE_SKEW_SECONDS = 1800;

// Public type AnomalyFlag for callers of this service.
export type AnomalyFlag =
  // Support the surrounding control flow.
  | "missing_end"
  // Support the surrounding control flow.
  | "overlap"
  // Support the surrounding control flow.
  | "duplicate_kind"
  // Support the surrounding control flow.
  | "absurd_duration"
  // Support the surrounding control flow.
  | "large_clock_skew";

/** Coerce JSON / unknown anomalyFlags into a typed string array. */
export function asFlags(value: unknown): AnomalyFlag[] {
  // Non-arrays (null / object) become empty — never throw on bad JSON.
  if (!Array.isArray(value)) return [];
  // Return computed result.
  return value.filter((v): v is AnomalyFlag => typeof v === "string") as AnomalyFlag[];
}

/** Deduplicate anomaly flags while preserving first-seen order via Set. */
export function uniqueFlags(flags: AnomalyFlag[]): AnomalyFlag[] {
  // Set iteration order is insertion order in modern JS engines.
  return Array.from(new Set(flags));
}

/** Date-only key for a hotel YMD (not a zoned instant). */
export function hotelDateKey(ymd: string): Date {
  // Stored as UTC midnight Date for Prisma Date columns.
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Sum paired break_start→break_end minutes within a window of events. */
function computeBreakMinutes(
  // Param events required by this function.
  events: Array<{ kind: AttendanceEventKind; normalizedTime: Date }>,
): number {
  // Counter total starts at 0.
  let total = 0;
  // Nullable breakStart until resolved.
  let breakStart: Date | null = null;
  // Sort so break pairs are processed in chronological order.
  const ordered = [...events].sort(
    // Support the surrounding control flow.
    (a, b) => a.normalizedTime.getTime() - b.normalizedTime.getTime(),
  );
  // Iterate items for aggregation or writes.
  for (const ev of ordered) {
    // Conditional path for this guard.
    if (ev.kind === AttendanceEventKind.break_start) {
      // Assign breakStart.
      breakStart = ev.normalizedTime;
    // Support the surrounding control flow.
    } else if (ev.kind === AttendanceEventKind.break_end && breakStart) {
      // Unmatched break_end (no prior start) is ignored.
      const mins = Math.max(
        0,
        // Support the surrounding control flow.
        Math.round(
          // Support the surrounding control flow.
          (ev.normalizedTime.getTime() - breakStart.getTime()) / 60_000,
        ),
      );
      // Assign total +.
      total += mins;
      // Assign breakStart.
      breakStart = null;
    }
  }
  // Return computed result.
  return total;
}

/** Net worked minutes (span minus breaks); null while the interval is still open. */
export function computeWorkedMinutes(
  // Param startedAt required by this function.
  startedAt: Date,
  // Param endedAt required by this function.
  endedAt: Date | null,
  // Param breakMinutes required by this function.
  breakMinutes: number,
): number | null {
  // Open intervals have no worked total yet.
  if (!endedAt) return null;
  // Derived metric raw.
  const raw = Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000);
  // Return computed result.
  return Math.max(0, raw - breakMinutes);
}

/** Reject inverted ranges and breaks longer than the effective interval span. */
export function assertValidAdjustmentTimes(
  // Param startedAt required by this function.
  startedAt: Date,
  // Param endedAt required by this function.
  endedAt: Date | null,
  // Param breakMinutes required by this function.
  breakMinutes: number,
): void {
  // Leaving endedAt null (still open) skips span checks.
  if (!endedAt) return;
  // Threshold/size gate.
  if (endedAt.getTime() <= startedAt.getTime()) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(400, "validation", "End must be after start");
  }
  // Derived metric spanMinutes.
  const spanMinutes = Math.round(
    // Support the surrounding control flow.
    (endedAt.getTime() - startedAt.getTime()) / 60_000,
  );
  // Conditional path for this guard.
  if (breakMinutes > spanMinutes) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(
      400,
      "validation",
      "Break minutes exceed interval duration",
    );
  }
}

// Public type RebuildEvent for callers of this service.
export type RebuildEvent = {
  // Field id on this type/payload.
  id: string;
  // Field kind on this type/payload.
  kind: AttendanceEventKind;
  // Time field normalizedTime.
  normalizedTime: Date;
  // Field clockSkewSeconds on this type/payload.
  clockSkewSeconds: number | null;
};

// Public type FrozenRange for callers of this service.
export type FrozenRange = { startMs: number; endMs: number };

// Public type IntervalDraft for callers of this service.
export type IntervalDraft = {
  // Time field startedAt.
  startedAt: Date;
  // Time field endedAt.
  endedAt: Date | null;
  // Field startEventId on this type/payload.
  startEventId: string | null;
  // Field endEventId on this type/payload.
  endEventId: string | null;
  // Field anomalyFlags on this type/payload.
  anomalyFlags: AnomalyFlag[];
  // Field breakMinutes on this type/payload.
  breakMinutes: number;
  // Field workedMinutes on this type/payload.
  workedMinutes: number | null;
  // Field status on this type/payload.
  status: AttendanceIntervalStatus;
  // Time field hotelDate.
  hotelDate: Date;
};

/** True when event time falls inside an approved/frozen adjustment range. */
function eventInFrozenRange(t: number, frozen: FrozenRange[]): boolean {
  // Inclusive endpoints — matches approved adjustment windows.
  return frozen.some((r) => t >= r.startMs && t <= r.endMs);
}

/** Pure event→interval pairing used by rebuild (and unit tests). */
export function pairEventsToIntervalDrafts(input: {
  // Param events required by this function.
  events: RebuildEvent[];
  // Param frozen required by this function.
  frozen: FrozenRange[];
  // Param timeZone required by this function.
  timeZone: string;
  // Param now required by this function.
  now?: Date;
// Support the surrounding control flow.
}): IntervalDraft[] {
  // Injectable `now` keeps missing_end age checks deterministic in tests.
  const now = input.now ?? new Date();
  // Skip events covered by frozen (manually adjusted) ranges.
  const usable = input.events.filter(
    // Support the surrounding control flow.
    (e) => !eventInFrozenRange(e.normalizedTime.getTime(), input.frozen),
  );

  // Type alias Open.
  type Open = {
    // Param startedAt required by this function.
    startedAt: Date;
    // Param startEventId required by this function.
    startEventId: string;
    // Param flags required by this function.
    flags: AnomalyFlag[];
  };

  // Nullable open until resolved.
  let open: Open | null = null;
  // Accumulator list drafts.
  const drafts: IntervalDraft[] = [];

  /** Flag large device/server clock skew on a single event. */
  function skewFlags(ev: RebuildEvent): AnomalyFlag[] {
    // Absolute skew ≥ LARGE_SKEW_SECONDS → large_clock_skew anomaly.
    if (
      // Additional clause in this boolean decision.
      ev.clockSkewSeconds != null &&
      // Support the surrounding control flow.
      Math.abs(ev.clockSkewSeconds) >= LARGE_SKEW_SECONDS
    ) {
      // Return computed result.
      return ["large_clock_skew"];
    }
    // Return computed result.
    return [];
  }

  /** Push one IntervalDraft with computed breaks, worked mins, and status. */
  function finalize(
    // Param startedAt required by this function.
    startedAt: Date,
    // Param endedAt required by this function.
    endedAt: Date | null,
    // Param startEventId required by this function.
    startEventId: string | null,
    // Param endEventId required by this function.
    endEventId: string | null,
    // Param flags required by this function.
    flags: AnomalyFlag[],
    // Param windowEvents required by this function.
    windowEvents: RebuildEvent[],
  ) {
    // Local breakMinutes used below.
    const breakMinutes = computeBreakMinutes(windowEvents);
    // Local workedMinutes used below.
    const workedMinutes = computeWorkedMinutes(startedAt, endedAt, breakMinutes);
    // Local nextFlags used below.
    const nextFlags = uniqueFlags(flags);
    // Closed span longer than ABSURD_DURATION_HOURS needs review.
    if (
      // Additional clause in this boolean decision.
      endedAt &&
      // Support the surrounding control flow.
      (endedAt.getTime() - startedAt.getTime()) / 3600_000 > ABSURD_DURATION_HOURS
    ) {
      // Support the surrounding control flow.
      nextFlags.push("absurd_duration");
    }
    // Open too long without clock-out → missing_end.
    if (!endedAt) {
      // Derived metric ageH.
      const ageH = (now.getTime() - startedAt.getTime()) / 3600_000;
      // Threshold/size gate.
      if (ageH >= OPEN_MISSING_END_HOURS) {
        // Support the surrounding control flow.
        nextFlags.push("missing_end");
      }
    }
    // Local uniq used below.
    const uniq = uniqueFlags(nextFlags);
    // Any anomaly → needs_review; clean closed → closed; else open.
    let status: AttendanceIntervalStatus = AttendanceIntervalStatus.open;
    // Conditional path for this guard.
    if (
      // Additional clause in this boolean decision.
      uniq.includes("missing_end") ||
      // Additional clause in this boolean decision.
      uniq.includes("overlap") ||
      // Additional clause in this boolean decision.
      uniq.includes("absurd_duration") ||
      // Additional clause in this boolean decision.
      uniq.includes("duplicate_kind") ||
      // Support the surrounding control flow.
      uniq.includes("large_clock_skew")
    ) {
      // Assign status.
      status = AttendanceIntervalStatus.needs_review;
    // Support the surrounding control flow.
    } else if (endedAt) {
      // Assign status.
      status = AttendanceIntervalStatus.closed;
    }
    // Support the surrounding control flow.
    drafts.push({
      startedAt,
      endedAt,
      startEventId,
      endEventId,
      // Set anomalyFlags.
      anomalyFlags: uniq,
      breakMinutes,
      workedMinutes,
      status,
      // Compute hotelDate for the payload.
      hotelDate: hotelDateAsUtcDate(startedAt, input.timeZone),
    });
  }

  // Iterate items for aggregation or writes.
  for (const ev of usable) {
    // Conditional path for this guard.
    if (ev.kind === AttendanceEventKind.clock_in) {
      // Second clock_in while open → duplicate_kind (keep first start).
      if (open) {
        // Assign open.flags.
        open.flags = uniqueFlags([
          // Spread additional fields/filters.
          ...open.flags,
          "duplicate_kind",
          // Spread additional fields/filters.
          ...skewFlags(ev),
        ]);
      // Support the surrounding control flow.
      } else {
        // Assign open.
        open = {
          // Time field startedAt.
          startedAt: ev.normalizedTime,
          // Field startEventId on this type/payload.
          startEventId: ev.id,
          // Field flags on this type/payload.
          flags: skewFlags(ev),
        };
      }
    // Support the surrounding control flow.
    } else if (ev.kind === AttendanceEventKind.clock_out) {
      // clock_out with no open → zero-length missing_end draft.
      if (!open) {
        // Invoke finalize.
        finalize(
          // Support the surrounding control flow.
          ev.normalizedTime,
          // Support the surrounding control flow.
          ev.normalizedTime,
          null,
          // Support the surrounding control flow.
          ev.id,
          // Invoke uniqueFlags.
          uniqueFlags(["missing_end", ...skewFlags(ev)]),
          // Support the surrounding control flow.
          [],
        );
      // Support the surrounding control flow.
      } else {
        // Local flags used below.
        const flags = uniqueFlags([...open.flags, ...skewFlags(ev)]);
        // Out before in is absurd.
        if (ev.normalizedTime < open.startedAt) {
          // Support the surrounding control flow.
          flags.push("absurd_duration");
        }
        // Breaks between this open's start and the clock_out.
        const windowEvents = usable.filter(
          // Support the surrounding control flow.
          (e) =>
            // Additional clause in this boolean decision.
            e.normalizedTime >= open!.startedAt &&
            // Support the surrounding control flow.
            e.normalizedTime <= ev.normalizedTime,
        );
        // Invoke finalize.
        finalize(
          // Support the surrounding control flow.
          open.startedAt,
          // Support the surrounding control flow.
          ev.normalizedTime,
          // Support the surrounding control flow.
          open.startEventId,
          // Support the surrounding control flow.
          ev.id,
          // Drop missing_end once we have a real end.
          flags.filter((f) => f !== "missing_end"),
          windowEvents,
        );
        // Assign open.
        open = null;
      }
    // Support the surrounding control flow.
    } else if (open) {
      // Break events while open: fold skew into the open interval's flags.
      open.flags = uniqueFlags([...open.flags, ...skewFlags(ev)]);
    }
  }

  // Trailing open interval (no clock_out yet).
  if (open) {
    // windowEvents: filtered subset.
    const windowEvents = usable.filter(
      // Support the surrounding control flow.
      (e) => e.normalizedTime >= open!.startedAt,
    );
    // Invoke finalize.
    finalize(
      // Support the surrounding control flow.
      open.startedAt,
      null,
      // Support the surrounding control flow.
      open.startEventId,
      null,
      // Support the surrounding control flow.
      open.flags,
      windowEvents,
    );
  }

  // Return computed result.
  return drafts;
}

/** Kinds that pair as interval start/end (breaks attach by time window). */
export function eventRequiresIntervalLink(kind: AttendanceEventKind): boolean {
  // Breaks are windowed onto intervals; only in/out create interval endpoints.
  return (
    // Additional clause in this boolean decision.
    kind === AttendanceEventKind.clock_in ||
    // Assign kind.
    kind === AttendanceEventKind.clock_out
  );
}
