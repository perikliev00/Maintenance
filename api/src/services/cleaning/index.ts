/**
 * Cleaning domain barrel: task/session lifecycle, cycles, claims, and ops.
 */
import { AppError } from "../../errors";

// Expose selected symbols from this module.
export { AppError };

// Re-export symbols from ./deriveServiceType for callers.
export { deriveCleaningServiceType } from "./deriveServiceType";

// Expose selected symbols from this module.
export {
  UNBOUND_CLEANING_CYCLE,
  formatCleaningHotelDate,
  isFutureHotelDate,
  resolveCycleForNewTask,
  allocateCleaningCycle,
  lockRebindableTasksAndLocation,
  bumpDirtyAndRebindWork,
// Execute: } from "./cycles";
} from "./cycles";

// Expose selected symbols from this module.
export {
  taskConflictDetails,
  // Local structural type for this module's contracts.
  type TaskConflictDetails,
// Execute: } from "./claims";
} from "./claims";

// Re-export symbols from ./tasks for callers.
export { createCleaningTask, reassignCleaningTask } from "./tasks";

// Expose selected symbols from this module.
export {
  startCleaningTask,
  completeCleaningSession,
  cancelCleaningSession,
// Execute: } from "./sessions";
} from "./sessions";

// Re-export symbols from ./inspection for callers.
export { inspectCleaningTask } from "./inspection";

// Re-export symbols from ./ops for callers.
export { listOverdueSessions, markRoomDirty } from "./ops";
