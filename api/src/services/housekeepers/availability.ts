/**
 * Real-time housekeeper availability for cleaning reassignment pickers.
 *
 * Classification never invents presence from roster alone. Missing or ambiguous
 * attendance yields `unknown`. Workload (assigned task count) is separate from
 * availability — assigned upcoming work does not make someone busy.
 */
import {
  AttendanceEventKind,
  AttendanceIntervalStatus,
  Prisma,
  Role,
  SessionStatus,
} from "@prisma/client";
import { ACTIVE_TASK_STATUSES } from "../../constants";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { CLEANING_ASSIGNEE_ROLES } from "../assignees";
import {
  getHotelNow,
  hotelDateAsUtcDate,
  hotelDateString,
  hotelLocalHhMm,
} from "../hotelTime";

// Re-export selected symbols for barrel consumers.
export { hotelLocalHhMm };
import { getOperations } from "../settings";

// Declare type AvailabilityStatus for callers and internals.
export type AvailabilityStatus =
  | "available"
  | "busy"
  | "on_break"
  | "off_shift"
  | "absent"
  | "unknown";

// Declare type HousekeeperAvailability for callers and internals.
export type HousekeeperAvailability = {
  employeeId: string;
  fullName: string;
  employeeNumber: string;
  availabilityStatus: AvailabilityStatus;
  availabilityReasons: string[];
  currentShift: {
    id: string;
    code: string;
    nameBg: string;
    nameEn: string;
    startTime: string;
    endTime: string;
  } | null;
  currentRunningTask: {
    taskId: string;
    locationId: string;
    locationNumber: string;
  } | null;
  assignedTaskCount: number;
  sectorEligibility: "hotel_wide";
  checkedAt: string;
};

// Declare type AvailableHousekeepersResult for callers and internals.
export type AvailableHousekeepersResult = {
  locationId: string;
  taskId: string | null;
  hotelDate: string;
  checkedAt: string;
  housekeepers: HousekeeperAvailability[];
};

/** Roles allowed to force-reassign despite non-available status. */
export const AVAILABILITY_OVERRIDE_ROLES: readonly Role[] = [
  Role.owner,
  Role.admin,
  Role.manager,
  Role.supervisor,
];

/** Statuses that an authorized override may bypass (never busy). */
export const OVERRIDABLE_AVAILABILITY: ReadonlySet<AvailabilityStatus> =
  new Set(["off_shift", "unknown", "on_break", "absent"]);

// Capture status sort for use in this scope.
const STATUS_SORT: Record<AvailabilityStatus, number> = {
  available: 0,
  unknown: 1,
  on_break: 2,
  busy: 3,
  absent: 4,
  off_shift: 5,
};

// Declare type AssigneeDb for callers and internals.
type AssigneeDb = Prisma.TransactionClient | typeof prisma;

/** Parse HH:mm to minutes since midnight; null if invalid. */
export function hhMmToMinutes(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Whether hotel-local HH:mm falls inside a shift window.
 * Overnight when start > end (e.g. 22:00–06:00). Equal start/end = full day.
 */
export function isWithinShiftWindow(
  nowHhMm: string,
  startTime: string,
  endTime: string,
): boolean {
  const now = hhMmToMinutes(nowHhMm);
  const start = hhMmToMinutes(startTime);
  const end = hhMmToMinutes(endTime);
  if (now == null || start == null || end == null) return false;
  if (start === end) return true;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

// Declare type ClassifyInput for callers and internals.
type ClassifyInput = {
  hasRunningSession: boolean;
  rosterShift: { startTime: string; endTime: string } | null;
  nowHhMm: string;
  /** Latest attendance interval for the hotel date, if any. */
  interval: {
    status: AttendanceIntervalStatus;
    startedAt: Date;
    endedAt: Date | null;
  } | null;
  /** True when an unpaired break_start exists after interval start. */
  onBreak: boolean;
};

/**
 * Pure classifier — unit-test without DB.
 * Order: busy → off_shift → attendance-derived states.
 */
export function classifyAvailability(
  input: ClassifyInput,
): { status: AvailabilityStatus; reasons: string[] } {
  const reasons: string[] = [];

  if (input.hasRunningSession) {
    // Append an entry to the accumulating collection.
    reasons.push("running_cleaning_session");
    return { status: "busy", reasons };
  }

  if (!input.rosterShift) {
    // Append an entry to the accumulating collection.
    reasons.push("no_roster_shift");
    return { status: "off_shift", reasons };
  }

  if (
    !isWithinShiftWindow(
      input.nowHhMm,
      input.rosterShift.startTime,
      input.rosterShift.endTime,
    )
  ) {
    // Append an entry to the accumulating collection.
    reasons.push("outside_shift_window");
    return { status: "off_shift", reasons };
  }

  // Append an entry to the accumulating collection.
  reasons.push("on_roster_shift");

  if (!input.interval) {
    // Append an entry to the accumulating collection.
    reasons.push("missing_attendance");
    return { status: "unknown", reasons };
  }

  if (input.interval.status === AttendanceIntervalStatus.needs_review) {
    // Append an entry to the accumulating collection.
    reasons.push("attendance_needs_review");
    return { status: "unknown", reasons };
  }

  if (
    input.interval.status === AttendanceIntervalStatus.open &&
    input.interval.endedAt == null
  ) {
    if (input.onBreak) {
      // Append an entry to the accumulating collection.
      reasons.push("on_break");
      return { status: "on_break", reasons };
    }
    // Append an entry to the accumulating collection.
    reasons.push("clocked_in");
    return { status: "available", reasons };
  }

  if (
    input.interval.status === AttendanceIntervalStatus.closed ||
    input.interval.status === AttendanceIntervalStatus.adjusted ||
    input.interval.endedAt != null
  ) {
    // Append an entry to the accumulating collection.
    reasons.push("clocked_out");
    return { status: "absent", reasons };
  }

  // Append an entry to the accumulating collection.
  reasons.push("ambiguous_attendance");
  return { status: "unknown", reasons };
}

/**
 * Batch-fetch availability rows for the given housekeeper ids (newest-first sort).
 * Exported for characterization tests; prefer listAvailableHousekeepers at call sites.
 */
export async function buildAvailability(input: {
  employees: Array<{ id: string; fullName: string; employeeNumber: string }>;
  db: AssigneeDb;
  now: Date;
  hotelDateKey: Date;
  nowHhMm: string;
  checkedAt: string;
}): Promise<HousekeeperAvailability[]> {
  const { employees, db, now, hotelDateKey, nowHhMm, checkedAt } = input;
  if (employees.length === 0) return [];

  const ids = employees.map((h) => h.id);

  const [rosters, intervals, runningSessions, taskCounts, breakEvents] =
    await Promise.all([
      // Persist or query via Prisma for durable state.
      db.employeeShiftRoster.findMany({
        where: { employeeId: { in: ids }, hotelDate: hotelDateKey },
        include: {
          shift: {
            select: {
              id: true,
              code: true,
              nameBg: true,
              nameEn: true,
              startTime: true,
              endTime: true,
              isActive: true,
            },
          },
        },
      }),
      // Persist or query via Prisma for durable state.
      db.attendanceInterval.findMany({
        where: {
          employeeId: { in: ids },
          hotelDate: hotelDateKey,
          status: {
            in: [
              AttendanceIntervalStatus.open,
              AttendanceIntervalStatus.closed,
              AttendanceIntervalStatus.needs_review,
              AttendanceIntervalStatus.adjusted,
            ],
          },
        },
        orderBy: { startedAt: "desc" },
      }),
      // Persist or query via Prisma for durable state.
      db.cleaningSession.findMany({
        where: {
          employeeId: { in: ids },
          status: SessionStatus.running,
        },
        include: {
          task: {
            select: {
              id: true,
              locationId: true,
              location: { select: { number: true } },
            },
          },
        },
      }),
      db.cleaningTask.groupBy({
        by: ["assignedEmployeeId"],
        where: {
          assignedEmployeeId: { in: ids },
          hotelDate: hotelDateKey,
          status: { in: ACTIVE_TASK_STATUSES },
        },
        _count: { _all: true },
      }),
      // Persist or query via Prisma for durable state.
      db.attendanceEvent.findMany({
        where: {
          employeeId: { in: ids },
          kind: {
            in: [AttendanceEventKind.break_start, AttendanceEventKind.break_end],
          },
          normalizedTime: {
            gte: new Date(now.getTime() - 36 * 60 * 60 * 1000),
          },
        },
        orderBy: { normalizedTime: "asc" },
        select: {
          employeeId: true,
          kind: true,
          normalizedTime: true,
        },
      }),
    ]);

  // Capture roster by employee for use in this scope.
  const rosterByEmployee = new Map(
    rosters
      // Continue the chained call from the previous expression.
      .filter((r) => r.shift.isActive)
      // Continue the chained call from the previous expression.
      .map((r) => [r.employeeId, r.shift] as const),
  );

  // Capture interval by employee for use in this scope.
  const intervalByEmployee = new Map<
    string,
    {
      status: AttendanceIntervalStatus;
      startedAt: Date;
      endedAt: Date | null;
    }
  >();
  // Iterate items to apply the same logic to each entry.
  for (const row of intervals) {
    if (!intervalByEmployee.has(row.employeeId)) {
      // Store a keyed value for later lookup.
      intervalByEmployee.set(row.employeeId, {
        status: row.status,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
      });
    }
  }

  // Capture running by employee for use in this scope.
  const runningByEmployee = new Map(
    runningSessions.map((s) => [
      s.employeeId,
      {
        taskId: s.task.id,
        locationId: s.task.locationId,
        locationNumber: s.task.location.number,
      },
    ]),
  );

  // Capture count by employee for use in this scope.
  const countByEmployee = new Map(
    taskCounts
      // Continue the chained call from the previous expression.
      .filter((c) => c.assignedEmployeeId != null)
      // Continue the chained call from the previous expression.
      .map((c) => [c.assignedEmployeeId!, c._count._all] as const),
  );

  // Capture on break by employee for use in this scope.
  const onBreakByEmployee = new Set<string>();
  // Capture break by employee for use in this scope.
  const breakByEmployee = new Map<
    string,
    Array<{ kind: AttendanceEventKind; normalizedTime: Date }>
  >();
  // Iterate items to apply the same logic to each entry.
  for (const ev of breakEvents) {
    const list = breakByEmployee.get(ev.employeeId) ?? [];
    // Append an entry to the accumulating collection.
    list.push({ kind: ev.kind, normalizedTime: ev.normalizedTime });
    // Store a keyed value for later lookup.
    breakByEmployee.set(ev.employeeId, list);
  }
  // Iterate items to apply the same logic to each entry.
  for (const id of ids) {
    const interval = intervalByEmployee.get(id);
    if (
      !interval ||
      interval.status !== AttendanceIntervalStatus.open ||
      interval.endedAt != null
    ) {
      // Skip to the next loop iteration.
      continue;
    }
    const events = (breakByEmployee.get(id) ?? []).filter(
      (e) => e.normalizedTime >= interval.startedAt,
    );
    // Capture open break for use in this scope.
    let openBreak = false;
    // Iterate items to apply the same logic to each entry.
    for (const e of events) {
      if (e.kind === AttendanceEventKind.break_start) openBreak = true;
      // Handle the alternate condition when prior branches did not match.
      else if (e.kind === AttendanceEventKind.break_end) openBreak = false;
    }
    if (openBreak) onBreakByEmployee.add(id);
  }

  const result: HousekeeperAvailability[] = employees.map((hk) => {
    const shift = rosterByEmployee.get(hk.id) ?? null;
    const running = runningByEmployee.get(hk.id) ?? null;
    const classified = classifyAvailability({
      hasRunningSession: running != null,
      rosterShift: shift
        // Complete the ternary or optional chain started above.
        ? { startTime: shift.startTime, endTime: shift.endTime }
        // Complete the ternary or optional chain started above.
        : null,
      nowHhMm,
      interval: intervalByEmployee.get(hk.id) ?? null,
      onBreak: onBreakByEmployee.has(hk.id),
    });

    return {
      employeeId: hk.id,
      fullName: hk.fullName,
      employeeNumber: hk.employeeNumber,
      availabilityStatus: classified.status,
      availabilityReasons: classified.reasons,
      currentShift: shift
        // Complete the ternary or optional chain started above.
        ? {
            id: shift.id,
            code: shift.code,
            nameBg: shift.nameBg,
            nameEn: shift.nameEn,
            startTime: shift.startTime,
            endTime: shift.endTime,
          }
        // Complete the ternary or optional chain started above.
        : null,
      currentRunningTask: running,
      assignedTaskCount: countByEmployee.get(hk.id) ?? 0,
      sectorEligibility: "hotel_wide" as const,
      checkedAt,
    };
  });

  result.sort(sortHousekeepers);
  return result;
}

function sortHousekeepers(
  a: HousekeeperAvailability,
  b: HousekeeperAvailability,
): number {
  // Capture by status for use in this scope.
  const byStatus =
    STATUS_SORT[a.availabilityStatus] - STATUS_SORT[b.availabilityStatus];
  if (byStatus !== 0) return byStatus;
  if (a.availabilityStatus === "available") {
    // Capture by load for use in this scope.
    const byLoad = a.assignedTaskCount - b.assignedTaskCount;
    if (byLoad !== 0) return byLoad;
  }
  return a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" });
}

/**
 * List housekeepers with real-time availability for a location (and optional task).
 * Excludes the task's current assignee when taskId is provided.
 */
export async function listAvailableHousekeepers(input: {
  locationId: string;
  taskId?: string | null;
  now?: Date;
  db?: AssigneeDb;
}): Promise<AvailableHousekeepersResult> {
  const db = input.db ?? prisma;
  const now = input.now ?? getHotelNow();
  const ops = await getOperations();
  // Capture time zone for use in this scope.
  const timeZone = ops.hotelTimezone;
  // Capture hotel date ymd for use in this scope.
  const hotelDateYmd = hotelDateString(now, timeZone);
  // Capture hotel date key for use in this scope.
  const hotelDateKey = hotelDateAsUtcDate(now, timeZone);
  // Capture now hh mm for use in this scope.
  const nowHhMm = hotelLocalHhMm(now, timeZone);
  // Capture checked at for use in this scope.
  const checkedAt = now.toISOString();

  const location = await db.location.findUnique({
    where: { id: input.locationId },
    select: {
      id: true,
      number: true,
      sectorMembership: {
        select: {
          sector: {
            select: { id: true, code: true, nameBg: true, nameEn: true },
          },
        },
      },
    },
  });
  if (!location) {
    throw new AppError(404, "not_found", "Location not found");
  }

  // Capture exclude employee id for use in this scope.
  let excludeEmployeeId: string | null = null;
  if (input.taskId) {
    const task = await db.cleaningTask.findUnique({
      where: { id: input.taskId },
      select: { id: true, locationId: true, assignedEmployeeId: true },
    });
    if (!task) {
      throw new AppError(404, "not_found", "Task not found");
    }
    if (task.locationId !== input.locationId) {
      throw new AppError(
        400,
        "validation",
        "Task does not belong to the given location",
      );
    }
    // Update exclude employee id as control flow progresses.
    excludeEmployeeId = task.assignedEmployeeId;
  }

  const housekeepers = await db.employee.findMany({
    where: {
      archivedAt: null,
      user: { role: { in: [...CLEANING_ASSIGNEE_ROLES] }, isActive: true },
      ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } : {}),
    },
    select: { id: true, fullName: true, employeeNumber: true },
    orderBy: { fullName: "asc" },
  });

  if (housekeepers.length === 0) {
    return {
      locationId: input.locationId,
      taskId: input.taskId ?? null,
      hotelDate: hotelDateYmd,
      checkedAt,
      housekeepers: [],
    };
  }

  const result = await buildAvailability({
    employees: housekeepers,
    db,
    now,
    hotelDateKey,
    nowHhMm,
    checkedAt,
  });

  return {
    locationId: input.locationId,
    taskId: input.taskId ?? null,
    hotelDate: hotelDateYmd,
    checkedAt,
    housekeepers: result,
  };
}

/**
 * Evaluate availability for a specific employee without needing a location list.
 * Preferred for reassign validation inside a transaction.
 */
export async function evaluateEmployeeAvailability(
  employeeId: string,
  opts: { now?: Date; db?: AssigneeDb } = {},
): Promise<HousekeeperAvailability | null> {
  const db = opts.db ?? prisma;
  const now = opts.now ?? getHotelNow();
  const ops = await getOperations();
  // Capture time zone for use in this scope.
  const timeZone = ops.hotelTimezone;
  // Capture hotel date key for use in this scope.
  const hotelDateKey = hotelDateAsUtcDate(now, timeZone);
  // Capture now hh mm for use in this scope.
  const nowHhMm = hotelLocalHhMm(now, timeZone);
  // Capture checked at for use in this scope.
  const checkedAt = now.toISOString();

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      fullName: true,
      employeeNumber: true,
      archivedAt: true,
      user: { select: { role: true, isActive: true } },
    },
  });
  if (
    employee?.archivedAt ||
    !employee?.user?.isActive ||
    !CLEANING_ASSIGNEE_ROLES.includes(employee.user.role)
  ) {
    return null;
  }

  const [availability] = await buildAvailability({
    employees: [
      {
        id: employee.id,
        fullName: employee.fullName,
        employeeNumber: employee.employeeNumber,
      },
    ],
    db,
    now,
    hotelDateKey,
    nowHhMm,
    checkedAt,
  });
  return availability ?? null;
}

/** Assert reassignment target is available, or override is allowed. */
export function assertReassignAvailability(input: {
  availability: HousekeeperAvailability | null;
  forceDespiteAvailability: boolean;
  actorRole: Role | undefined;
}): void {
  if (!input.availability) {
    throw new AppError(
      400,
      "validation",
      "Replacement must be an active housekeeper",
    );
  }

  if (input.availability.availabilityStatus === "available") {
    // Exit early; nothing more to do on this path.
    return;
  }

  if (input.availability.availabilityStatus === "busy") {
    throw new AppError(
      409,
      "availability_conflict",
      "Replacement is currently performing another cleaning session",
      {
        availabilityStatus: input.availability.availabilityStatus,
        availabilityReasons: input.availability.availabilityReasons,
        currentRunningTask: input.availability.currentRunningTask,
        checkedAt: input.availability.checkedAt,
      },
    );
  }

  if (input.forceDespiteAvailability) {
    if (
      !input.actorRole ||
      !AVAILABILITY_OVERRIDE_ROLES.includes(input.actorRole)
    ) {
      throw new AppError(
        403,
        "forbidden",
        "Not authorized to override housekeeper availability",
      );
    }
    if (!OVERRIDABLE_AVAILABILITY.has(input.availability.availabilityStatus)) {
      throw new AppError(
        409,
        "availability_conflict",
        "This availability status cannot be overridden",
        {
          availabilityStatus: input.availability.availabilityStatus,
          availabilityReasons: input.availability.availabilityReasons,
          checkedAt: input.availability.checkedAt,
        },
      );
    }
    // Exit early; nothing more to do on this path.
    return;
  }

  throw new AppError(
    409,
    "availability_conflict",
    "Replacement is not currently available",
    {
      availabilityStatus: input.availability.availabilityStatus,
      availabilityReasons: input.availability.availabilityReasons,
      currentRunningTask: input.availability.currentRunningTask,
      checkedAt: input.availability.checkedAt,
    },
  );
}
