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
  // Carry this field through the payload or query.
  UNBOUND_CLEANING_CYCLE,
  // Carry this field through the payload or query.
  formatCleaningHotelDate,
  // Carry this field through the payload or query.
  isFutureHotelDate,
  // Carry this field through the payload or query.
  resolveCycleForNewTask,
  // Carry this field through the payload or query.
  allocateCleaningCycle,
  // Carry this field through the payload or query.
  lockRebindableTasksAndLocation,
  // Carry this field through the payload or query.
  bumpDirtyAndRebindWork,
// Execute: } from "./cycles";
} from "./cycles";

// Expose selected symbols from this module.
export {
  // Carry this field through the payload or query.
  taskConflictDetails,
  // Local structural type for this module's contracts.
  type TaskConflictDetails,
// Execute: } from "./claims";
} from "./claims";

// Re-export symbols from ./tasks for callers.
export { createCleaningTask, reassignCleaningTask } from "./tasks";

// Expose selected symbols from this module.
export {
  // Carry this field through the payload or query.
  startCleaningTask,
  // Carry this field through the payload or query.
  completeCleaningSession,
  // Carry this field through the payload or query.
  cancelCleaningSession,
// Execute: } from "./sessions";
} from "./sessions";

// Re-export symbols from ./inspection for callers.
export { inspectCleaningTask } from "./inspection";

// Re-export symbols from ./ops for callers.
export { listOverdueSessions, markRoomDirty } from "./ops";
