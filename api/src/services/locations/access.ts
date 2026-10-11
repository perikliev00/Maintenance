import { LocationKind } from "@prisma/client";
import { AppError } from "../../errors";
import {
  assertCanAccessLocation,
  type DataScope,
} from "../dataScope";
import { findLocationById } from "./crud";

export async function loadScopedLocation(
  scope: DataScope,
  id: string,
  opts?: {
    kind?: LocationKind;
    activeOnly?: boolean;
    notFoundMessage?: string;
  },
) {
  const message = opts?.notFoundMessage ?? "Location not found";
  const location = await findLocationById(id, opts?.kind);
  if (!location) {
    throw new AppError(404, "not_found", message);
  }
  if (opts?.activeOnly && location.catalogStatus !== "active") {
    throw new AppError(404, "not_found", message);
  }
  await assertCanAccessLocation(scope, location.id);
  return location;
}
