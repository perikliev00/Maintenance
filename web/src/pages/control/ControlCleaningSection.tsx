// Import module dependency from ../controlPageState.
import { taskAssigneeSelectValue } from "../controlPageState";
// Import type-only dependency for typing without runtime cost.
import type { ControlBoard } from "./useControlBoard";

// Declare type alias Props.
type Props = Pick<
  // Support the surrounding logic for this step.
  ControlBoard,
  // Support the surrounding logic for this step.
  | "rooms"
  // Support the surrounding logic for this step.
  | "housekeepers"
  // Support the surrounding logic for this step.
  | "taskRoomId"
  // Support the surrounding logic for this step.
  | "setTaskRoomId"
  // Support the surrounding logic for this step.
  | "taskAssignee"
  // Support the surrounding logic for this step.
  | "setTaskAssignee"
  // Support the surrounding logic for this step.
  | "taskPriority"
  // Support the surrounding logic for this step.
  | "setTaskPriority"
  // Support the surrounding logic for this step.
  | "creatingTask"
  // Support the surrounding logic for this step.
  | "onCreateTask"
  // Support the surrounding logic for this step.
  | "cleaningError"
>;

// Export function ControlCleaningSection as part of this module's API.
export function ControlCleaningSection({
  // Support the surrounding logic for this step.
  rooms,
  // Support the surrounding logic for this step.
  housekeepers,
  // Support the surrounding logic for this step.
  taskRoomId,
  // Support the surrounding logic for this step.
  setTaskRoomId,
  // Support the surrounding logic for this step.
  taskAssignee,
  // Support the surrounding logic for this step.
  setTaskAssignee,
  // Support the surrounding logic for this step.
  taskPriority,
  // Support the surrounding logic for this step.
  setTaskPriority,
  // Support the surrounding logic for this step.
  creatingTask,
  // Support the surrounding logic for this step.
  onCreateTask,
  // Support the surrounding logic for this step.
  cleaningError,
// Support the surrounding logic for this step.
}: Props) {
  // Return the JSX/UI tree for this render path.
  return (
    // Render a <section> element for layout or semantics.
    <section className="panel">
      <h2>Създай задача за почистване</h2>
      {cleaningError && <p className="error">{cleaningError}</p>}
      <form className="report-form" onSubmit={onCreateTask}>
        <label>
          Стая
          <select
            // Pass value prop/value into the element or config.
            value={taskRoomId}
            // Pass onChange prop/value into the element or config.
            onChange={(e) => setTaskRoomId(e.target.value)}
            required
          >
            {rooms.map((room) => (
              // Render a <option> element for layout or semantics.
              <option key={room.id} value={room.id}>
                                {room.buildingCode} {room.number}
              </option>
            // Support the surrounding logic for this step.
            ))}
          </select>
        </label>
        <label>
          Камериер
          <select
            // Pass value prop/value into the element or config.
            value={taskAssigneeSelectValue(taskAssignee)}
            // Pass onChange prop/value into the element or config.
            onChange={(e) =>
              // Update React state so the UI reflects the new value.
              setTaskAssignee({
                // Provide status field used by this structure.
                status: "chosen",
                // Provide employeeId field used by this structure.
                employeeId: e.target.value,
              })
            }
          >
            <option value="">Unassigned</option>
            {housekeepers.map((hk) => (
              // Render a <option> element for layout or semantics.
              <option key={hk.id} value={hk.id}>
                                {hk.fullName} ({hk.employeeNumber})
              </option>
            // Support the surrounding logic for this step.
            ))}
          </select>
        </label>
        <label>
          Приоритет
          <select
            // Pass value prop/value into the element or config.
            value={taskPriority}
            // Pass onChange prop/value into the element or config.
            onChange={(e) => setTaskPriority(e.target.value)}
          >
            <option value="low">low</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
            <option value="urgent">urgent</option>
          </select>
        </label>
        <button type="submit" disabled={creatingTask || !taskRoomId}>
          {creatingTask ? "Creating…" : "Create task"}
        </button>
      </form>
    </section>
  );
}
