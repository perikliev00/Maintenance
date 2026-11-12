/**
 * Hotel-local calendar helpers: map UTC instants to the configured hotel
 * timezone (YYYY-MM-DD / Prisma Date keys) with safe fallbacks for bad zones.
 */
import { AppError } from "../errors";
// Import module ./settings for this service.
import { getOperations } from "./settings";

// Capture hotel tz fallback for use in this scope.
const HOTEL_TZ_FALLBACK = "UTC";
// Capture warned invalid hotel time zones for use in this scope.
const warnedInvalidHotelTimeZones = new Set<string>();

/** Resolve a usable IANA zone; invalid values fall back to UTC with a one-shot warn. */
export function resolveUsableHotelTimeZone(timeZone: string): {
  // Set timeZone on the structure being built.
  timeZone: string;
  // Set usedFallback on the structure being built.
  usedFallback: boolean;
// Run next step: } {
} {
  // Attempt the fallible work so errors can be handled below.
  try {
    // Probe Intl — throws RangeError for unknown IANA zones.
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    // Return the computed result to the caller.
    return { timeZone, usedFallback: false };
  // Run next step: } catch {
  } catch {
    // Warn once per bad zone string to avoid log spam on every request.
    if (!warnedInvalidHotelTimeZones.has(timeZone)) {
      // Run next step: warnedInvalidHotelTimeZones.add(timeZone);
      warnedInvalidHotelTimeZones.add(timeZone);
      // Run next step: console.error(
      console.error(
        // Run next step: `Invalid hotelTimezone "${timeZone}"; falling back to ${HOTE…
        `Invalid hotelTimezone "${timeZone}"; falling back to ${HOTEL_TZ_FALLBACK}`,
      );
    }
    // Return the computed result to the caller.
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
    // Set timeZone on the structure being built.
    timeZone: resolved.timeZone,
    // Set year on the structure being built.
    year: "numeric",
    // Set month on the structure being built.
    month: "2-digit",
    // Set day on the structure being built.
    day: "2-digit",
  // Run next step: }).format(instant);
  }).format(instant);
}

/**
 * Prisma `@db.Date` key: calendar YMD stored as UTC midnight.
 * Not the same as zoned local midnight — see {@link zonedDayStartUtc}.
 */
export function hotelDateAsUtcDate(instant: Date, timeZone: string): Date {
  // Capture ymd for use in this scope.
  const ymd = hotelDateString(instant, timeZone);
  // Store as UTC midnight of the hotel calendar day (not zoned midnight).
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Test-only override for "now"; production always uses wall clock. */
let hotelNowOverride: Date | null = null;

/** Current instant for hotel-date "today" (wall clock unless tests override). */
export function getHotelNow(): Date {
  // Return the computed result to the caller.
  return hotelNowOverride ?? new Date();
}

/**
 * Temporarily freeze hotel "now" for tests that must prove start paths
 * compute today via {@link todayHotelDateYmd} + operations.hotelTimezone.
 */
export async function withHotelNowForTests<T>(
  // Set instant on the structure being built.
  instant: Date,
  // Set fn on the structure being built.
  fn: () => Promise<T>,
// Run next step: ): Promise<T> {
): Promise<T> {
  // Capture previous for use in this scope.
  const previous = hotelNowOverride;
  // Update hotel now override as control flow progresses.
  hotelNowOverride = instant;
  // Attempt the fallible work so errors can be handled below.
  try {
    // Return the computed result to the caller.
    return await fn();
  // Run next step: } finally {
  } finally {
    // Update hotel now override as control flow progresses.
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
  // Return the computed result to the caller.
  return hotelDateString(instant ?? getHotelNow(), ops.hotelTimezone);
}

/**
 * Offset (ms) such that `utc + offset ≈ wall clock in timeZone`.
 * Used by {@link zonedDayStartUtc} for DST-safe midnight conversion.
 */
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  // Capture resolved for use in this scope.
  const resolved = resolveUsableHotelTimeZone(timeZone).timeZone;
  // Format wall-clock parts in the hotel zone, then reinterpret as UTC.
  const parts = new Intl.DateTimeFormat("en-US", {
    // Set timeZone on the structure being built.
    timeZone: resolved,
    // Set hour12 on the structure being built.
    hour12: false,
    // Set year on the structure being built.
    year: "numeric",
    // Set month on the structure being built.
    month: "2-digit",
    // Set day on the structure being built.
    day: "2-digit",
    // Set hour on the structure being built.
    hour: "2-digit",
    // Set minute on the structure being built.
    minute: "2-digit",
    // Set second on the structure being built.
    second: "2-digit",
  // Run next step: }).formatToParts(instant);
  }).formatToParts(instant);
  // Collapse formatToParts into a type → value map (skip literals).
  const map: Record<string, string> = {};
  // Iterate items to apply the same logic to each entry.
  for (const p of parts) {
    // Branch when this condition holds so the right path runs.
    if (p.type !== "literal") map[p.type] = p.value;
  }
  // Some engines emit "24" for midnight — normalize to 0.
  const hour = Number(map.hour === "24" ? "0" : map.hour);
  // Rebuild the wall-clock instant as if those parts were UTC.
  const asUtc = Date.UTC(
    // Run next step: Number(map.year),
    Number(map.year),
    // Run next step: Number(map.month) - 1,
    Number(map.month) - 1,
    // Run next step: Number(map.day),
    Number(map.day),
    // Run next step: hour,
    hour,
    // Run next step: Number(map.minute),
    Number(map.minute),
    // Run next step: Number(map.second),
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
  // Branch when this condition holds so the right path runs.
  if (!y || !m || !d) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "Invalid hotel date (expected YYYY-MM-DD)");
  }
  // First guess: treat YMD midnight as if it were UTC.
  const asUtcWall = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  // Two-pass offset refine handles DST transitions correctly.
  let utc = asUtcWall - timeZoneOffsetMs(new Date(asUtcWall), timeZone);
  // Update utc as control flow progresses.
  utc = asUtcWall - timeZoneOffsetMs(new Date(utc), timeZone);
  // Return the computed result to the caller.
  return new Date(utc);
}

/** Hotel-local HH:mm for an instant in a timezone. */
export function hotelLocalHhMm(instant: Date, timeZone: string): string {
  // Capture resolved for use in this scope.
  const resolved = resolveUsableHotelTimeZone(timeZone).timeZone;
  // Capture parts for use in this scope.
  const parts = new Intl.DateTimeFormat("en-US", {
    // Set timeZone on the structure being built.
    timeZone: resolved,
    // Set hour12 on the structure being built.
    hour12: false,
    // Set hour on the structure being built.
    hour: "2-digit",
    // Set minute on the structure being built.
    minute: "2-digit",
  // Run next step: }).formatToParts(instant);
  }).formatToParts(instant);
  // Capture map for use in this scope.
  const map: Record<string, string> = {};
  // Iterate items to apply the same logic to each entry.
  for (const p of parts) {
    // Branch when this condition holds so the right path runs.
    if (p.type !== "literal") map[p.type] = p.value;
  }
  // Capture hour for use in this scope.
  const hour = map.hour === "24" ? "00" : map.hour;
  // Return the computed result to the caller.
  return `${hour}:${map.minute}`;
}

/**
 * YYYY-MM-DD from a Prisma `@db.Date` stored as UTC midnight.
 * Prefer {@link hotelDateString} when converting a live UTC instant in a zone.
 */
export function formatHotelDate(d: Date): string {
  // ISO date portion only; safe because values are stored as UTC midnight.
  return d.toISOString().slice(0, 10);
}

/** Add calendar days to a YYYY-MM-DD string (UTC date arithmetic). */
export function addDaysYmd(ymd: string, days: number): string {
  // Parse as UTC midnight, mutate UTC day, re-format.
  const d = new Date(`${ymd}T00:00:00.000Z`);
  // Run next step: d.setUTCDate(d.getUTCDate() + days);
  d.setUTCDate(d.getUTCDate() + days);
  // Return the computed result to the caller.
  return formatHotelDate(d);
}
