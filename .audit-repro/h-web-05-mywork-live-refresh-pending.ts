/**
 * Audit repro H-WEB-05: MyWorkPage.refresh() clears pendingSyncTaskIds on every
 * successful fetch (including useLiveRefresh), while tasks.tsx contract disables
 * start/complete only while pendingSync — server snapshot can re-enable actions
 * while the outbox still holds the mutation.
 */
import assert from "node:assert/strict";

type Task = {
  id: string;
  status: string;
  sessions: { id: string; status: string }[];
};

/** TaskCard gating from web/src/pages/myWork/tasks.tsx */
function canStart(task: Task, pendingSync: boolean): boolean {
  const running = task.sessions.some((s) => s.status === "running");
  return (
    (task.status === "assigned" || task.status === "rework") &&
    !running &&
    !pendingSync
  );
}

function canComplete(task: Task, pendingSync: boolean): boolean {
  const running = task.sessions.some((s) => s.status === "running");
  return Boolean(running) && !pendingSync;
}

/** Minimal MyWork refresh + complete handler semantics (HEAD 2ec3f517). */
function createMyWorkModel() {
  let tasks: Task[] = [];
  let pendingSyncTaskIds: string[] = [];
  let outboxPending = 0;

  function refreshFromServer(serverTasks: Task[]) {
    tasks = serverTasks;
    pendingSyncTaskIds = [];
  }

  function startQueued(taskId: string) {
    outboxPending += 1;
    pendingSyncTaskIds = pendingSyncTaskIds.includes(taskId)
      ? pendingSyncTaskIds
      : [...pendingSyncTaskIds, taskId];
    tasks = tasks.map((row) =>
      row.id === taskId ? { ...row, status: "in_progress" } : row,
    );
  }

  function completeQueued(taskId: string) {
    outboxPending += 1;
    tasks = tasks.map((row) =>
      row.id === taskId
        ? {
            ...row,
            status: "completed",
            sessions: row.sessions.map((s) =>
              s.status === "running" ? { ...s, status: "completed" } : s,
            ),
          }
        : row,
    );
    // MyWorkPage onComplete: does NOT add taskId to pendingSyncTaskIds when queued.
  }

  return {
    getTask: (id: string) => tasks.find((t) => t.id === id)!,
    getPendingSync: () => pendingSyncTaskIds,
    getOutboxPending: () => outboxPending,
    refreshFromServer,
    startQueued,
    completeQueued,
    canStartTask: (id: string) =>
      canStart(
        tasks.find((t) => t.id === id)!,
        pendingSyncTaskIds.includes(id),
      ),
    canCompleteTask: (id: string) =>
      canComplete(
        tasks.find((t) => t.id === id)!,
        pendingSyncTaskIds.includes(id),
      ),
  };
}

async function main() {
  const mw = createMyWorkModel();
  const taskId = "task-1";

  mw.refreshFromServer([
    {
      id: taskId,
      status: "in_progress",
      sessions: [{ id: "sess-1", status: "running" }],
    },
  ]);

  mw.completeQueued(taskId);
  assert.equal(mw.canCompleteTask(taskId), false, "optimistic complete hides running");

  mw.refreshFromServer([
    {
      id: taskId,
      status: "in_progress",
      sessions: [{ id: "sess-1", status: "running" }],
    },
  ]);

  const doubleFireAllowed = mw.canCompleteTask(taskId) && mw.getOutboxPending() > 0;
  console.log(
    JSON.stringify({
      pendingSyncTaskIds: mw.getPendingSync(),
      outboxPending: mw.getOutboxPending(),
      canCompleteAfterLiveRefresh: mw.canCompleteTask(taskId),
      doubleFireAllowed,
    }),
  );

  assert.ok(doubleFireAllowed, "complete button re-enabled while outbox still pending");
  console.log(
    "H-WEB-05 RESULT: DOUBLE_COMPLETE_GATE_OPEN — violates tasks.tsx pendingSync contract",
  );

  const mw2 = createMyWorkModel();
  mw2.refreshFromServer([
    { id: taskId, status: "assigned", sessions: [] },
  ]);
  mw2.startQueued(taskId);
  assert.equal(mw2.canStartTask(taskId), false);
  mw2.refreshFromServer([
    { id: taskId, status: "assigned", sessions: [] },
  ]);
  const startDouble = mw2.canStartTask(taskId) && mw2.getOutboxPending() > 0;
  console.log(
    JSON.stringify({
      scenario: "queued_start_then_live_refresh",
      startDoubleFireAllowed: startDouble,
    }),
  );
  assert.ok(startDouble, "start re-enabled after refresh cleared pendingSync");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
