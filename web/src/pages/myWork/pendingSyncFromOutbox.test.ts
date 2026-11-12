// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency from ./pendingSyncFromOutbox.
import { taskIdsFromQueuedActions } from "./pendingSyncFromOutbox";
// Import type-only dependency for typing without runtime cost.
import type { QueuedAction } from "../../offline";

// Define function row and its behavior.
function row(
  // Provide partial field used by this structure.
  partial: Partial<QueuedAction> &
    // Support the surrounding logic for this step.
    Pick<QueuedAction, "type" | "url" | "status">,
// Support the surrounding logic for this step.
): QueuedAction {
  // Bind id for use in the following logic.
  const id = partial.id ?? "q1";
  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    id,
    // Provide userId field used by this structure.
    userId: "u1",
    // Provide createdAt field used by this structure.
    createdAt: 1,
    // Provide updatedAt field used by this structure.
    updatedAt: 1,
    // Provide body field used by this structure.
    body: partial.body ?? {},
    // Provide method field used by this structure.
    method: "POST",
    // Provide lastError field used by this structure.
    lastError: null,
    // Provide conflictCode field used by this structure.
    conflictCode: null,
    // Provide conflictMessage field used by this structure.
    conflictMessage: null,
    // Provide conflictDetails field used by this structure.
    conflictDetails: null,
    // Provide retries field used by this structure.
    retries: 0,
    // Spread prior fields/items so overrides can layer cleanly.
    ...partial,
    // commandId is required on QueuedAction; Partial<> would leave it optional.
    commandId: partial.commandId ?? `cmd-${id}`,
  };
}

// Group related tests under a shared suite name.
describe("pendingSyncFromOutbox (My Work hypothesis)", () => {
  // Define a single test case and its expectation.
  it("keeps cleaning.start task ids while pending/sending", () => {
    // Bind ids for use in the following logic.
    const ids = taskIdsFromQueuedActions([
      // Invoke row to perform this step.
      row({
        // Declare a type alias.
        type: "cleaning.start",
        // Provide url field used by this structure.
        url: "/api/tasks/task-1/start",
        // Provide status field used by this structure.
        status: "pending",
        // Provide body field used by this structure.
        body: { taskId: "task-1" },
      }),
      // Invoke row to perform this step.
      row({
        // Provide id field used by this structure.
        id: "q2",
        // Declare a type alias.
        type: "cleaning.complete",
        // Provide url field used by this structure.
        url: "/api/sessions/s1/complete",
        // Provide status field used by this structure.
        status: "sending",
        // Provide body field used by this structure.
        body: { taskId: "task-2" },
      }),
      // Invoke row to perform this step.
      row({
        // Provide id field used by this structure.
        id: "q3",
        // Declare a type alias.
        type: "cleaning.start",
        // Provide url field used by this structure.
        url: "/api/tasks/task-3/start",
        // Provide status field used by this structure.
        status: "conflict",
        // Provide body field used by this structure.
        body: { taskId: "task-3" },
      }),
    // Support the surrounding logic for this step.
    ]);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(ids.sort(), ["task-1", "task-2"]);
  });

  // Define a single test case and its expectation.
  it("ignores unrelated outbox types", () => {
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke taskIdsFromQueuedActions to perform this step.
      taskIdsFromQueuedActions([
        // Invoke row to perform this step.
        row({
          // Declare a type alias.
          type: "ticket.resolve",
          // Provide url field used by this structure.
          url: "/api/tickets/t1/resolve",
          // Provide status field used by this structure.
          status: "pending",
          // Provide body field used by this structure.
          body: { ticketId: "t1" },
        }),
      // Support the surrounding logic for this step.
      ]),
      // Support the surrounding logic for this step.
      [],
    );
  });
});
