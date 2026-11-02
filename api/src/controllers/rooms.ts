/** Room location list/get/mark-dirty; results filtered by the caller's DataScope. */
import { LocationKind } from "@prisma/client";
import { createLocationKindController } from "./locationsBoard";

export const { list, get, markDirty } = createLocationKindController(
  LocationKind.room,
  "Room not found",
);
