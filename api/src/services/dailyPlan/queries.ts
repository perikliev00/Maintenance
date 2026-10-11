import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { parseHotelDate } from "../dailyPlanEffects";
import { mapBatch, mapEntry } from "./format";
import { entryInclude } from "./types";

export async function getDailyPlan(
  hotelDate: string,
  locationFilter?: Prisma.LocationWhereInput,
) {
  const date = parseHotelDate(hotelDate);

  const entries = await prisma.dailyPlanEntry.findMany({
    where: {
      hotelDate: date,
      ...(locationFilter ? { location: locationFilter } : {}),
    },
    include: entryInclude,
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
  });

  const lastImport = await prisma.dailyPlanImportBatch.findFirst({
    where: { hotelDate: date },
    orderBy: { createdAt: "desc" },
  });

  const mapped = entries.map(mapEntry);
  return {
    date: hotelDate,
    departures: mapped.filter((e) => e.category === "departure"),
    arrivals: mapped.filter((e) => e.category === "arrival"),
    priority: mapped.filter((e) => e.category === "priority"),
    lastImport: lastImport ? mapBatch(lastImport) : null,
  };
}
