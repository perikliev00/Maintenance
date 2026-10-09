import { AppError } from "../errors";
import { getOperations } from "./settings";

const HOTEL_TZ_FALLBACK = "UTC";
const warnedInvalidHotelTimeZones = new Set<string>();

/** Resolve a usable IANA zone; invalid values fall back to UTC with a one-shot warn. */
export function resolveUsableHotelTimeZone(timeZone: string): {
  timeZone: string;
  usedFallback: boolean;
} {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return { timeZone, usedFallback: false };
  } catch {
    if (!warnedInvalidHotelTimeZones.has(timeZone)) {
      warnedInvalidHotelTimeZones.add(timeZone);
      console.error(
        `Invalid hotelTimezone "${timeZone}"; falling back to ${HOTEL_TZ_FALLBACK}`,
      );
    }
    return { timeZone: HOTEL_TZ_FALLBACK, usedFallback: true };
  }
}

/** Hotel calendar date (YYYY-MM-DD) in the configured timezone for a UTC instant. */
export function hotelDateString(instant: Date, timeZone: string): string {
  const resolved = resolveUsableHotelTimeZone(timeZone);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: resolved.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Prisma `@db.Date` key: calendar YMD stored as UTC midnight. */
export function hotelDateAsUtcDate(instant: Date, timeZone: string): Date {
  const ymd = hotelDateString(instant, timeZone);
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Today's hotel calendar date (YYYY-MM-DD) in configured operations.hotelTimezone. */
export async function todayHotelDateYmd(instant: Date = new Date()): Promise<string> {
  const ops = await getOperations();
  return hotelDateString(instant, ops.hotelTimezone);
}

/** Offset (ms) such that `utc + offset ≈ wall clock in timeZone`. */
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const resolved = resolveUsableHotelTimeZone(timeZone).timeZone;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolved,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const hour = Number(map.hour === "24" ? "0" : map.hour);
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - instant.getTime();
}

/**
 * UTC instant of local midnight for a hotel calendar day in `timeZone`.
 * DST-safe (two-pass offset refine).
 */
export function zonedDayStartUtc(ymd: string, timeZone: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) {
    throw new AppError(400, "validation", "Invalid hotel date (expected YYYY-MM-DD)");
  }
  const asUtcWall = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  let utc = asUtcWall - timeZoneOffsetMs(new Date(asUtcWall), timeZone);
  utc = asUtcWall - timeZoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}
