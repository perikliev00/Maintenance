/** Common-area location list/get/mark-dirty; scoped like rooms. */
import { LocationKind } from "@prisma/client";
import { createLocationKindController } from "./locationsBoard";

export const { list, get, markDirty } = createLocationKindController(
  LocationKind.common_area,
  "Common area not found",
);
