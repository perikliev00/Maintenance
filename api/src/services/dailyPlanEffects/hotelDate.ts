import { AppError } from "../../errors";

export function parseHotelDate(hotelDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hotelDate)) {
    throw new AppError(400, "validation", "hotelDate must be YYYY-MM-DD");
  }
  return new Date(`${hotelDate}T00:00:00.000Z`);
}

export function formatHotelDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
