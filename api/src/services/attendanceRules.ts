import {
  AttendanceEventKind,
  AttendanceIntervalStatus,
} from "@prisma/client";
import { AppError } from "../errors";
import { hotelDateAsUtcDate } from "./hotelTime";

export const OPEN_MISSING_END_HOURS = 14;
const ABSURD_DURATION_HOURS = 16;
const LARGE_SKEW_SECONDS = 1800;

export type AnomalyFlag =
  | "missing_end"
  | "overlap"
  | "duplicate_kind"
  | "absurd_duration"
  | "large_clock_skew";

export function asFlags(value: unknown): AnomalyFlag[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is AnomalyFlag => typeof v === "string") as AnomalyFlag[];
}

export function uniqueFlags(flags: AnomalyFlag[]): AnomalyFlag[] {
  return Array.from(new Set(flags));
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Date-only key for a hotel YMD (not a zoned instant). */
export function hotelDateKey(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function computeBreakMinutes(
  events: Array<{ kind: AttendanceEventKind; normalizedTime: Date }>,
): number {
  let total = 0;
  let breakStart: Date | null = null;
  const ordered = [...events].sort(
    (a, b) => a.normalizedTime.getTime() - b.normalizedTime.getTime(),
  );
  for (const ev of ordered) {
    if (ev.kind === AttendanceEventKind.break_start) {
      breakStart = ev.normalizedTime;
    } else if (ev.kind === AttendanceEventKind.break_end && breakStart) {
      const mins = Math.max(
        0,
        Math.round(
          (ev.normalizedTime.getTime() - breakStart.getTime()) / 60_000,
        ),
      );
      total += mins;
      breakStart = null;
    }
  }
  return total;
}

export function computeWorkedMinutes(
  startedAt: Date,
  endedAt: Date | null,
  breakMinutes: number,
): number | null {
  if (!endedAt) return null;
  const raw = Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000);
  return Math.max(0, raw - breakMinutes);
}

/** Reject inverted ranges and breaks longer than the effective interval span. */
export function assertValidAdjustmentTimes(
  startedAt: Date,
  endedAt: Date | null,
  breakMinutes: number,
): void {
  if (!endedAt) return;
  if (endedAt.getTime() <= startedAt.getTime()) {
    throw new AppError(400, "validation", "End must be after start");
  }
  const spanMinutes = Math.round(
    (endedAt.getTime() - startedAt.getTime()) / 60_000,
  );
  if (breakMinutes > spanMinutes) {
    throw new AppError(
      400,
      "validation",
      "Break minutes exceed interval duration",
    );
  }
}

export type RebuildEvent = {
  id: string;
  kind: AttendanceEventKind;
  normalizedTime: Date;
  clockSkewSeconds: number | null;
};

export type FrozenRange = { startMs: number; endMs: number };

export type IntervalDraft = {
  startedAt: Date;
  endedAt: Date | null;
  startEventId: string | null;
  endEventId: string | null;
  anomalyFlags: AnomalyFlag[];
  breakMinutes: number;
  workedMinutes: number | null;
  status: AttendanceIntervalStatus;
  hotelDate: Date;
};

function eventInFrozenRange(t: number, frozen: FrozenRange[]): boolean {
  return frozen.some((r) => t >= r.startMs && t <= r.endMs);
}

/** Pure event→interval pairing used by rebuild (and unit tests). */
export function pairEventsToIntervalDrafts(input: {
  events: RebuildEvent[];
  frozen: FrozenRange[];
  timeZone: string;
  now?: Date;
}): IntervalDraft[] {
  const now = input.now ?? new Date();
  const usable = input.events.filter(
    (e) => !eventInFrozenRange(e.normalizedTime.getTime(), input.frozen),
  );

  type Open = {
    startedAt: Date;
    startEventId: string;
    flags: AnomalyFlag[];
  };

  let open: Open | null = null;
  const drafts: IntervalDraft[] = [];

  function skewFlags(ev: RebuildEvent): AnomalyFlag[] {
    if (
      ev.clockSkewSeconds != null &&
      Math.abs(ev.clockSkewSeconds) >= LARGE_SKEW_SECONDS
    ) {
      return ["large_clock_skew"];
    }
    return [];
  }

  function finalize(
    startedAt: Date,
    endedAt: Date | null,
    startEventId: string | null,
    endEventId: string | null,
    flags: AnomalyFlag[],
    windowEvents: RebuildEvent[],
  ) {
    const breakMinutes = computeBreakMinutes(windowEvents);
    const workedMinutes = computeWorkedMinutes(startedAt, endedAt, breakMinutes);
    const nextFlags = uniqueFlags(flags);
    if (
      endedAt &&
      (endedAt.getTime() - startedAt.getTime()) / 3600_000 > ABSURD_DURATION_HOURS
    ) {
      nextFlags.push("absurd_duration");
    }
    if (!endedAt) {
      const ageH = (now.getTime() - startedAt.getTime()) / 3600_000;
      if (ageH >= OPEN_MISSING_END_HOURS) {
        nextFlags.push("missing_end");
      }
    }
    const uniq = uniqueFlags(nextFlags);
    let status: AttendanceIntervalStatus = AttendanceIntervalStatus.open;
    if (
      uniq.includes("missing_end") ||
      uniq.includes("overlap") ||
      uniq.includes("absurd_duration") ||
      uniq.includes("duplicate_kind") ||
      uniq.includes("large_clock_skew")
    ) {
      status = AttendanceIntervalStatus.needs_review;
    } else if (endedAt) {
      status = AttendanceIntervalStatus.closed;
    }
    drafts.push({
      startedAt,
      endedAt,
      startEventId,
      endEventId,
      anomalyFlags: uniq,
      breakMinutes,
      workedMinutes,
      status,
      hotelDate: hotelDateAsUtcDate(startedAt, input.timeZone),
    });
  }

  for (const ev of usable) {
    if (ev.kind === AttendanceEventKind.clock_in) {
      if (open) {
        open.flags = uniqueFlags([
          ...open.flags,
          "duplicate_kind",
          ...skewFlags(ev),
        ]);
      } else {
        open = {
          startedAt: ev.normalizedTime,
          startEventId: ev.id,
          flags: skewFlags(ev),
        };
      }
    } else if (ev.kind === AttendanceEventKind.clock_out) {
      if (!open) {
        finalize(
          ev.normalizedTime,
          ev.normalizedTime,
          null,
          ev.id,
          uniqueFlags(["missing_end", ...skewFlags(ev)]),
          [],
        );
      } else {
        const flags = uniqueFlags([...open.flags, ...skewFlags(ev)]);
        if (ev.normalizedTime < open.startedAt) {
          flags.push("absurd_duration");
        }
        const windowEvents = usable.filter(
          (e) =>
            e.normalizedTime >= open!.startedAt &&
            e.normalizedTime <= ev.normalizedTime,
        );
        finalize(
          open.startedAt,
          ev.normalizedTime,
          open.startEventId,
          ev.id,
          flags.filter((f) => f !== "missing_end"),
          windowEvents,
        );
        open = null;
      }
    } else if (open) {
      open.flags = uniqueFlags([...open.flags, ...skewFlags(ev)]);
    }
  }

  if (open) {
    const windowEvents = usable.filter(
      (e) => e.normalizedTime >= open!.startedAt,
    );
    finalize(
      open.startedAt,
      null,
      open.startEventId,
      null,
      open.flags,
      windowEvents,
    );
  }

  return drafts;
}

/** Kinds that pair as interval start/end (breaks attach by time window). */
export function eventRequiresIntervalLink(kind: AttendanceEventKind): boolean {
  return (
    kind === AttendanceEventKind.clock_in ||
    kind === AttendanceEventKind.clock_out
  );
}
