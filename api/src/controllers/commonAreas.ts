/** Common-area location list/get/mark-dirty; scoped like rooms. */
import { LocationKind } from "@prisma/client";
// Import local module ./locationsBoard.
import { createLocationKindController } from "./locationsBoard";

// Destructure and export handlers produced by the kind-specific factory.
export const { list, get, markDirty } = createLocationKindController(
  // Specialize the board factory by location kind.
  LocationKind.common_area,
  // Client-facing message when the entity is missing or out of scope.
  "Common area not found",
);
