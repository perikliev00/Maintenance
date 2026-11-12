import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taskIdsFromQueuedActions } from "./pendingSyncFromOutbox";
import type { QueuedAction } from "../../offline";

// Define function row and its behavior.
function row(
  partial: Partial<QueuedAction> &
    Pick<QueuedAction, "type" | "url" | "status">,
): QueuedAction {
  const id = partial.id ?? "q1";
  return {
    id,
    userId: "u1",
    createdAt: 1,
    updatedAt: 1,
    body: partial.body ?? {},
    method: "POST",
    lastError: null,
    conflictCode: null,
    conflictMessage: null,
    conflictDetails: null,
    retries: 0,
    ...partial,
    // commandId is required on QueuedAction; Partial<> would leave it optional.
    commandId: partial.commandId ?? `cmd-${id}`,
  };
}

describe("pendingSyncFromOutbox (My Work hypothesis)", () => {
  it("keeps cleaning.start task ids while pending/sending", () => {
    const ids = taskIdsFromQueuedActions([
      row({
        type: "cleaning.start",
        url: "/api/tasks/task-1/start",
        status: "pending",
        body: { taskId: "task-1" },
      }),
      row({
        id: "q2",
        type: "cleaning.complete",
        url: "/api/sessions/s1/complete",
        status: "sending",
        body: { taskId: "task-2" },
      }),
      row({
        id: "q3",
        type: "cleaning.start",
        url: "/api/tasks/task-3/start",
        status: "conflict",
        body: { taskId: "task-3" },
      }),
    ]);
    assert.deepEqual(ids.sort(), ["task-1", "task-2"]);
  });

  it("ignores unrelated outbox types", () => {
    assert.deepEqual(
      taskIdsFromQueuedActions([
        row({
          type: "ticket.resolve",
          url: "/api/tickets/t1/resolve",
          status: "pending",
          body: { ticketId: "t1" },
        }),
      ]),
      [],
    );
  });
});
