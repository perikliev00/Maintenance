/**
 * Hotel-date string helpers for daily plan (UTC-midnight Date columns).
 */
import { AppError } from "../../errors";

/** YYYY-MM-DD from a Prisma `@db.Date` stored as UTC midnight. */
export function formatHotelDate(d: Date): string {
  // ISO date portion only; safe because values are stored as UTC midnight.
  return d.toISOString().slice(0, 10);
}

/**
 * Parse and validate a calendar YYYY-MM-DD into a UTC-midnight Date.
 * Rejects malformed strings and impossible calendar dates.
 */
export function parseHotelDate(hotelDate: string): Date {
  // Strict shape check before Date parsing (avoids locale-dependent Date() quirks).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hotelDate)) {
    throw new AppError(400, "validation", "hotelDate must be YYYY-MM-DD");
  }
  // Force UTC midnight so Prisma `@db.Date` round-trips cleanly.
  const parsed = new Date(`${hotelDate}T00:00:00.000Z`);
  // Reject invalid calendars (e.g. 2024-02-31) by requiring format round-trip.
  if (Number.isNaN(parsed.getTime()) || formatHotelDate(parsed) !== hotelDate) {
    throw new AppError(400, "validation", "hotelDate must be a valid calendar date");
  }
  return parsed;
}

/** Add calendar days to a YYYY-MM-DD string (UTC date arithmetic). */
export function addDaysYmd(ymd: string, days: number): string {
  // Parse as UTC midnight, mutate UTC day, re-format.
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
