import { useCallback, useEffect, useState } from "react";
import {
  completeCleaningSession,
  createCleaningTask,
  fetchHousekeepers,
  fetchRooms,
  markRoomDirty,
  startCleaningTask,
  todayHotelDate,
  type AuthUser,
  type Room,
} from "../api/client";

type Props = {
  user: AuthUser;
  onLogout: () => void;
};

export function RoomsPage({ user, onLogout }: Props) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [housekeepers, setHousekeepers] = useState<
    Array<{ id: string; fullName: string; employeeNumber: string }>
  >([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);

  const canManage = user.role === "reception" || user.role === "supervisor";
  const canWork = user.role === "housekeeper" || user.role === "supervisor";

  const refresh = useCallback(async () => {
    setError(null);
    const data = await fetchRooms();
    setRooms(data);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await refresh();
        if (canManage) {
          const hk = await fetchHousekeepers();
          setHousekeepers(hk);
          if (hk[0]) setAssigneeId(hk[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load rooms");
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh, canManage]);

  async function runAction(roomId: string, action: () => Promise<void>) {
    setBusyRoomId(roomId);
    setError(null);
    setMessage(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyRoomId(null);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <strong>Imperial Maintenance</strong>
          <span className="muted"> / Rooms</span>
        </div>
        <div className="topbar-right">
          <span>
            {user.fullName} · {user.role}
          </span>
          <button type="button" className="ghost" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>

      <main className="content">
        {canManage && (
          <div className="toolbar">
            <label>
              Assign housekeeper when creating task
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {housekeepers.map((hk) => (
                  <option key={hk.id} value={hk.id}>
                    {hk.fullName} ({hk.employeeNumber})
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="ghost" onClick={() => refresh()}>
              Refresh
            </button>
          </div>
        )}

        {error && <div className="error banner">{error}</div>}
        {message && <div className="ok banner">{message}</div>}

        {loading ? (
          <p className="muted">Loading rooms…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Building</th>
                  <th>Floor</th>
                  <th>Occupancy</th>
                  <th>Cleaning</th>
                  <th>Service</th>
                  <th>Readiness</th>
                  <th>Task</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => {
                  const busy = busyRoomId === room.id;
                  const task = room.activeTask;
                  const isMyRunning =
                    task?.runningSession?.employeeId === user.employeeId;

                  return (
                    <tr key={room.id}>
                      <td>{room.number}</td>
                      <td>{room.buildingCode}</td>
                      <td>{room.floor}</td>
                      <td>{room.occupancy}</td>
                      <td>
                        <span className={`pill cleaning-${room.cleaningStatus}`}>
                          {room.cleaningStatus}
                        </span>
                      </td>
                      <td>{room.serviceStatus}</td>
                      <td>
                        <span className={`pill ready-${room.readiness}`}>
                          {room.readiness}
                        </span>
                        {room.readinessReasons.length > 0 && (
                          <div className="reasons">
                            {room.readinessReasons.join(", ")}
                          </div>
                        )}
                      </td>
                      <td>
                        {task ? (
                          <div>
                            <div>
                              {task.status}
                              {task.assignee ? ` · ${task.assignee.fullName}` : ""}
                            </div>
                            {task.runningSession && (
                              <div className="muted">session running</div>
                            )}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="actions">
                        {canManage && room.cleaningStatus !== "dirty" && !task && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              runAction(room.id, async () => {
                                await markRoomDirty(room.id);
                                setMessage(`Room ${room.number} marked dirty`);
                              })
                            }
                          >
                            Mark dirty
                          </button>
                        )}
                        {canManage && !task && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              runAction(room.id, async () => {
                                await createCleaningTask({
                                  locationId: room.id,
                                  hotelDate: todayHotelDate(),
                                  priority: "normal",
                                  assignedEmployeeId: assigneeId || undefined,
                                });
                                setMessage(`Task created for room ${room.number}`);
                              })
                            }
                          >
                            Create task
                          </button>
                        )}
                        {canWork &&
                          task &&
                          task.status === "assigned" &&
                          !task.runningSession &&
                          (!task.assignee ||
                            task.assignee.id === user.employeeId) && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                runAction(room.id, async () => {
                                  await startCleaningTask(task.id, task.version);
                                  setMessage(`Started cleaning room ${room.number}`);
                                })
                              }
                            >
                              Start
                            </button>
                          )}
                        {canWork && task?.runningSession && isMyRunning && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                runAction(room.id, async () => {
                                  await completeCleaningSession(
                                    task.runningSession!.id,
                                  );
                                  setMessage(
                                    `Completed cleaning room ${room.number}`,
                                  );
                                })
                              }
                            >
                              Complete
                            </button>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
