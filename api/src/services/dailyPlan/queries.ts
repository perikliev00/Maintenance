/**
 * Read the daily plan for a hotel date, split by category, plus last import.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { parseHotelDate } from "../dailyPlanEffects";
import { mapBatch, mapEntry } from "./format";
import { entryInclude } from "./types";

/**
 * Load plan entries for `hotelDate`, optionally scoped by `locationFilter`
 * (data-scope). Groups into departures / arrivals / priority buckets.
 */
export async function getDailyPlan(
  hotelDate: string,
  locationFilter?: Prisma.LocationWhereInput,
) {
  // Normalize YYYY-MM-DD into the Date used as DailyPlanEntry.hotelDate.
  const date = parseHotelDate(hotelDate);

  // All plan rows for the day, optionally limited by data-scope location filter.
  const entries = await prisma.dailyPlanEntry.findMany({
    where: {
      hotelDate: date,
      ...(locationFilter ? { location: locationFilter } : {}),
    },
    include: entryInclude,
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
  });

  // Most recent import batch metadata for the same hotel date (audit / UI).
  const lastImport = await prisma.dailyPlanImportBatch.findFirst({
    where: { hotelDate: date },
    orderBy: { createdAt: "desc" },
  });

  // Shape Prisma rows into API DTOs, then bucket by plan category.
  const mapped = entries.map(mapEntry);
  return {
    date: hotelDate,
    departures: mapped.filter((e) => e.category === "departure"),
    arrivals: mapped.filter((e) => e.category === "arrival"),
    priority: mapped.filter((e) => e.category === "priority"),
    lastImport: lastImport ? mapBatch(lastImport) : null,
  };
}
