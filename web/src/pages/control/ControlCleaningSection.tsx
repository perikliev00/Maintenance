import { taskAssigneeSelectValue } from "../controlPageState";
import type { ControlBoard } from "./useControlBoard";

type Props = Pick<
  ControlBoard,
  | "rooms"
  | "housekeepers"
  | "taskRoomId"
  | "setTaskRoomId"
  | "taskAssignee"
  | "setTaskAssignee"
  | "taskPriority"
  | "setTaskPriority"
  | "creatingTask"
  | "onCreateTask"
  | "cleaningError"
>;

export function ControlCleaningSection({
  rooms,
  housekeepers,
  taskRoomId,
  setTaskRoomId,
  taskAssignee,
  setTaskAssignee,
  taskPriority,
  setTaskPriority,
  creatingTask,
  onCreateTask,
  cleaningError,
}: Props) {
  return (
    <section className="panel">
      <h2>Създай задача за почистване</h2>
      {cleaningError && <p className="error">{cleaningError}</p>}
      <form className="report-form" onSubmit={onCreateTask}>
        <label>
          Стая
          <select
            value={taskRoomId}
            onChange={(e) => setTaskRoomId(e.target.value)}
            required
          >
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.buildingCode} {room.number}
              </option>
            ))}
          </select>
        </label>
        <label>
          Камериер
          <select
            value={taskAssigneeSelectValue(taskAssignee)}
            onChange={(e) =>
              setTaskAssignee({
                status: "chosen",
                employeeId: e.target.value,
              })
            }
          >
            <option value="">Unassigned</option>
            {housekeepers.map((hk) => (
              <option key={hk.id} value={hk.id}>
                {hk.fullName} ({hk.employeeNumber})
              </option>
            ))}
          </select>
        </label>
        <label>
          Приоритет
          <select
            value={taskPriority}
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
