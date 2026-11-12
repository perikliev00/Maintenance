/**
 * Read the daily plan for a hotel date, split by category, plus last import.
 */
import { Prisma } from "@prisma/client";
// Import ../../db for dailyPlan/queries.ts.
import { prisma } from "../../db";
// Import ../dailyPlanEffects for dailyPlan/queries.ts.
import { parseHotelDate } from "../dailyPlanEffects";
// Import ./format for dailyPlan/queries.ts.
import { mapBatch, mapEntry } from "./format";
// Import ./types for dailyPlan/queries.ts.
import { entryInclude } from "./types";

/**
 * Load plan entries for `hotelDate`, optionally scoped by `locationFilter`
 * (data-scope). Groups into departures / arrivals / priority buckets.
 */
export async function getDailyPlan(
  // Carry this field through the payload or query.
  hotelDate: string,
  // Parameter/field in the surrounding signature or type.
  locationFilter?: Prisma.LocationWhereInput,
// Begin block/object for the following statements.
) {
  // Normalize YYYY-MM-DD into the Date used as DailyPlanEntry.hotelDate.
  const date = parseHotelDate(hotelDate);

  // All plan rows for the day, optionally limited by data-scope location filter.
  const entries = await prisma.dailyPlanEntry.findMany({
    // Restrict the query to the relevant rows only.
    where: {
      // Carry this field through the payload or query.
      hotelDate: date,
      // Field value required by this payload or query.
      location: { AND: [locationFilter ?? {}, { catalogStatus: "active" }] },
    },
    // Eager-load relations needed by the API response shape.
    include: entryInclude,
    // Stable sort so list pages stay deterministic.
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
  });

  // Most recent import batch metadata for the same hotel date (audit / UI).
  const lastImport = await prisma.dailyPlanImportBatch.findFirst({
    // Restrict the query to the relevant rows only.
    where: { hotelDate: date },
    // Stable sort so list pages stay deterministic.
    orderBy: { createdAt: "desc" },
  });

  // Shape Prisma rows into API DTOs, then bucket by plan category.
  const mapped = entries.map(mapEntry);
  // Return the computed result to the caller.
  return {
    // Carry this field through the payload or query.
    date: hotelDate,
    // Field value required by this payload or query.
    departures: mapped.filter((e) => e.category === "departure"),
    // Field value required by this payload or query.
    arrivals: mapped.filter((e) => e.category === "arrival"),
    // Field value required by this payload or query.
    priority: mapped.filter((e) => e.category === "priority"),
    // Field value required by this payload or query.
    lastImport: lastImport ? mapBatch(lastImport) : null,
  };
}
