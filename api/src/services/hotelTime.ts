/**
 * Hotel-local calendar helpers: map UTC instants to the configured hotel
 * timezone (YYYY-MM-DD / Prisma Date keys) with safe fallbacks for bad zones.
 */
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
    // Probe Intl — throws RangeError for unknown IANA zones.
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return { timeZone, usedFallback: false };
  } catch {
    // Warn once per bad zone string to avoid log spam on every request.
    if (!warnedInvalidHotelTimeZones.has(timeZone)) {
      warnedInvalidHotelTimeZones.add(timeZone);
      console.error(
        `Invalid hotelTimezone "${timeZone}"; falling back to ${HOTEL_TZ_FALLBACK}`,
      );
    }
    return { timeZone: HOTEL_TZ_FALLBACK, usedFallback: true };
  }
}

/**
 * Hotel calendar date (YYYY-MM-DD) in the configured timezone for a UTC instant.
 * Invalid zones fall back to UTC via {@link resolveUsableHotelTimeZone}.
 */
export function hotelDateString(instant: Date, timeZone: string): string {
  // Resolve (or fall back) before formatting so Intl never throws here.
  const resolved = resolveUsableHotelTimeZone(timeZone);
  // en-CA yields YYYY-MM-DD reliably.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: resolved.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * Prisma `@db.Date` key: calendar YMD stored as UTC midnight.
 * Not the same as zoned local midnight — see {@link zonedDayStartUtc}.
 */
export function hotelDateAsUtcDate(instant: Date, timeZone: string): Date {
  const ymd = hotelDateString(instant, timeZone);
  // Store as UTC midnight of the hotel calendar day (not zoned midnight).
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Test-only override for "now"; production always uses wall clock. */
let hotelNowOverride: Date | null = null;

/** Current instant for hotel-date "today" (wall clock unless tests override). */
export function getHotelNow(): Date {
  return hotelNowOverride ?? new Date();
}

/**
 * Temporarily freeze hotel "now" for tests that must prove start paths
 * compute today via {@link todayHotelDateYmd} + operations.hotelTimezone.
 */
export async function withHotelNowForTests<T>(
  instant: Date,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = hotelNowOverride;
  hotelNowOverride = instant;
  try {
    return await fn();
  } finally {
    hotelNowOverride = previous;
  }
}

/**
 * Today's hotel calendar date (YYYY-MM-DD) in configured operations.hotelTimezone.
 * Defaults `instant` to {@link getHotelNow} for call sites that only need "today".
 */
export async function todayHotelDateYmd(instant?: Date): Promise<string> {
  // Load operations settings for the configured hotelTimezone.
  const ops = await getOperations();
  return hotelDateString(instant ?? getHotelNow(), ops.hotelTimezone);
}

/**
 * Offset (ms) such that `utc + offset ≈ wall clock in timeZone`.
 * Used by {@link zonedDayStartUtc} for DST-safe midnight conversion.
 */
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const resolved = resolveUsableHotelTimeZone(timeZone).timeZone;
  // Format wall-clock parts in the hotel zone, then reinterpret as UTC.
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
  // Collapse formatToParts into a type → value map (skip literals).
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  // Some engines emit "24" for midnight — normalize to 0.
  const hour = Number(map.hour === "24" ? "0" : map.hour);
  // Rebuild the wall-clock instant as if those parts were UTC.
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  // Difference is the zone offset at this instant.
  return asUtc - instant.getTime();
}

/**
 * UTC instant of local midnight for a hotel calendar day in `timeZone`.
 * DST-safe (two-pass offset refine).
 */
export function zonedDayStartUtc(ymd: string, timeZone: string): Date {
  // Split YYYY-MM-DD; reject empties / NaN parts early.
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) {
    throw new AppError(400, "validation", "Invalid hotel date (expected YYYY-MM-DD)");
  }
  // First guess: treat YMD midnight as if it were UTC.
  const asUtcWall = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  // Two-pass offset refine handles DST transitions correctly.
  let utc = asUtcWall - timeZoneOffsetMs(new Date(asUtcWall), timeZone);
  utc = asUtcWall - timeZoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}
