/**
 * Hotel-date string helpers for daily plan (UTC-midnight Date columns).
 */
import { AppError } from "../../errors";
// Import ../hotelTime for dailyPlanEffects/hotelDate.ts.
import { addDaysYmd, formatHotelDate } from "../hotelTime";

// Expose selected symbols from this module.
export { addDaysYmd, formatHotelDate };

/**
 * Parse and validate a calendar YYYY-MM-DD into a UTC-midnight Date.
 * Rejects malformed strings and impossible calendar dates.
 */
export function parseHotelDate(hotelDate: string): Date {
  // Strict shape check before Date parsing (avoids locale-dependent Date() quirks).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hotelDate)) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(400, "validation", "hotelDate must be YYYY-MM-DD");
  }
  // Force UTC midnight so Prisma `@db.Date` round-trips cleanly.
  const parsed = new Date(`${hotelDate}T00:00:00.000Z`);
  // Reject invalid calendars (e.g. 2024-02-31) by requiring format round-trip.
  if (Number.isNaN(parsed.getTime()) || formatHotelDate(parsed) !== hotelDate) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(400, "validation", "hotelDate must be a valid calendar date");
  }
  return parsed;
}
