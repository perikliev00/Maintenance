// Import dependency used by this module.
import assert from "node:assert/strict";
// Import dependency used by this module.
import { describe, it } from "node:test";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  canRebaseConflict,
  // List item in import/export/params.
  decideSyncResult,
  // List item in import/export/params.
  entityIdFromQueued,
  // List item in import/export/params.
  parseConflictDetails,
  // List item in import/export/params.
  rebaseBodyWithCurrentVersion,
  // List item in import/export/params.
  shouldTreatForbiddenAsConflict,
// Close multi-line construct with trailing syntax.
} from "./conflict";

// Group related unit tests.
describe("decideSyncResult", () => {
  // Unit test case.
  it("deletes only on ok", () => {
    // Assert expected test outcome.
    assert.equal(decideSyncResult({ status: "ok" }, 0, 8).status, "deleted");
  });

  // Unit test case.
  it("keeps conflict rows with reason and details", () => {
    // Local constant binding.
    const patch = decideSyncResult(
      {
        // Field/property in this shape.
        status: "conflict",
        // Field/property in this shape.
        code: "version_conflict",
        // Field/property in this shape.
        message: "Task was updated by another user",
        // Field/property in this shape.
        details: { currentVersion: 4, expectedVersion: 2, status: "assigned" },
      },
      // Continue multi-line list/arguments.
      0,
      // Continue multi-line list/arguments.
      8,
    );
    // Assert expected test outcome.
    assert.equal(patch.status, "conflict");
    // Assert expected test outcome.
    assert.equal(patch.conflictCode, "version_conflict");
    // Assert expected test outcome.
    assert.equal(patch.conflictMessage, "Task was updated by another user");
    // Assert expected test outcome.
    assert.deepEqual(patch.conflictDetails, {
      // Field/property in this shape.
      currentVersion: 4,
      // Field/property in this shape.
      expectedVersion: 2,
      // Field/property in this shape.
      status: "assigned",
    });
  });

  // Unit test case.
  it("maps assignee forbidden to conflict (legacy servers)", () => {
    // Local constant binding.
    const patch = decideSyncResult(
      {
        // Field/property in this shape.
        status: "forbidden",
        // Field/property in this shape.
        code: "assignee_conflict",
        // Field/property in this shape.
        message: "Task was reassigned to another employee",
        // Field/property in this shape.
        details: { currentVersion: 3, assignedEmployeeId: "emp-x" },
      },
      // Continue multi-line list/arguments.
      0,
      // Continue multi-line list/arguments.
      8,
    );
    // Assert expected test outcome.
    assert.equal(patch.status, "conflict");
    // Assert expected test outcome.
    assert.equal(patch.conflictCode, "assignee_conflict");
  });

  // Unit test case.
  it("keeps true permission denials as failed", () => {
    // Local constant binding.
    const patch = decideSyncResult(
      {
        // Field/property in this shape.
        status: "forbidden",
        // Field/property in this shape.
        message: "Missing cleaning.start",
      },
      // Continue multi-line list/arguments.
      0,
      // Continue multi-line list/arguments.
      8,
    );
    // Assert expected test outcome.
    assert.equal(patch.status, "failed");
  });

  // Unit test case.
  it("uses stable fallback text when conflict metadata is absent or blank", () => {
    // Assert expected test outcome.
    assert.deepEqual(decideSyncResult({ status: "conflict" }, 0, 8), {
      // Field/property in this shape.
      status: "conflict",
      // Field/property in this shape.
      lastError: "conflict",
      // Field/property in this shape.
      conflictCode: null,
      // Field/property in this shape.
      conflictMessage: null,
      // Field/property in this shape.
      conflictDetails: null,
    });
    // Assert expected test outcome.
    assert.equal(
      // Invoke helper or pass arguments.
      decideSyncResult({ status: "conflict", message: "   " }, 0, 8).lastError,
      // Continue multi-line list/arguments.
      "conflict",
    );
  });

  // Unit test case.
  it("uses an explicit conflict code even when the message is empty", () => {
    // Local constant binding.
    const patch = decideSyncResult(
      // Continue multi-line list/arguments.
      { status: "forbidden", code: "out_of_scope", message: "" },
      // Continue multi-line list/arguments.
      0,
      // Continue multi-line list/arguments.
      8,
    );
    // Assert expected test outcome.
    assert.equal(patch.status, "conflict");
    // Assert expected test outcome.
    assert.equal(patch.lastError, "conflict");
  });

  // Unit test case.
  it("does not treat whitespace-only metadata as meaningful", () => {
    // Local constant binding.
    const patch = decideSyncResult(
      // Continue multi-line list/arguments.
      { status: "error", code: "  ", message: "   " },
      // Continue multi-line list/arguments.
      0,
      // Continue multi-line list/arguments.
      8,
    );
    // Assert expected test outcome.
    assert.equal(patch.lastError, "error");
    // Assert expected test outcome.
    assert.equal(patch.conflictCode, null);
  });

  // Unit test case.
  it("marks permanent validation errors failed without further auto-retry", () => {
    // Local constant binding.
    const patch = decideSyncResult(
      {
        // Field/property in this shape.
        status: "error",
        // Field/property in this shape.
        code: "validation",
        // Field/property in this shape.
        message: "Invalid command payload",
        // Field/property in this shape.
        retryable: false,
      },
      // Continue multi-line list/arguments.
      0,
      // Continue multi-line list/arguments.
      8,
    );
    // Assert expected test outcome.
    assert.equal(patch.status, "failed");
    // Assert expected test outcome.
    assert.equal(patch.lastError, "Invalid command payload");
  });

  // Unit test case.
  it("keeps temporary failures pending until max retries then fails", () => {
    // Local constant binding.
    const mid = decideSyncResult(
      {
        // Field/property in this shape.
        status: "error",
        // Field/property in this shape.
        message: "Temporary command failure",
        // Field/property in this shape.
        retryable: true,
      },
      // Continue multi-line list/arguments.
      2,
      // Continue multi-line list/arguments.
      8,
    );
    // Assert expected test outcome.
    assert.equal(mid.status, "pending");
    // Assert expected test outcome.
    assert.equal(mid.retries, 3);
    // Local constant binding.
    const last = decideSyncResult(
      {
        // Field/property in this shape.
        status: "error",
        // Field/property in this shape.
        message: "Temporary command failure",
        // Field/property in this shape.
        retryable: true,
      },
      // Continue multi-line list/arguments.
      7,
      // Continue multi-line list/arguments.
      8,
    );
    // Assert expected test outcome.
    assert.equal(last.status, "failed");
    // Assert expected test outcome.
    assert.equal(last.retries, 8);
  });
});

// Group related unit tests.
describe("rebaseBodyWithCurrentVersion", () => {
  // Unit test case.
  it("rewrites expectedVersion from conflict details", () => {
    // Local constant binding.
    const next = rebaseBodyWithCurrentVersion(
      // Continue multi-line list/arguments.
      { commandId: "c1", expectedVersion: 2 },
      // Continue multi-line list/arguments.
      { currentVersion: 5, expectedVersion: 2 },
    );
    // Assert expected test outcome.
    assert.deepEqual(next, { commandId: "c1", expectedVersion: 5 });
  });

  // Unit test case.
  it("returns null when currentVersion missing", () => {
    // Assert expected test outcome.
    assert.equal(
      // Invoke helper or pass arguments.
      rebaseBodyWithCurrentVersion({ expectedVersion: 1 }, { status: "assigned" }),
      // List item in import/export/params.
      null,
    );
  });

  // Unit test case.
  it("refuses invalid numeric versions that the API cannot accept", () => {
    // Iterate collection / range.
    for (const currentVersion of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      // Assert expected test outcome.
      assert.equal(
        // Invoke helper or pass arguments.
        rebaseBodyWithCurrentVersion({ expectedVersion: 1 }, { currentVersion }),
        // List item in import/export/params.
        null,
      );
      // Assert expected test outcome.
      assert.equal(canRebaseConflict("version_conflict", { currentVersion }), false);
    }
    // Assert expected test outcome.
    assert.deepEqual(
      // Open multi-line construct.
      parseConflictDetails({
        // Field/property in this shape.
        expectedVersion: 0,
        // Field/property in this shape.
        currentVersion: Number.MAX_SAFE_INTEGER + 1,
      }),
      {},
    );
    // Assert expected test outcome.
    assert.deepEqual(parseConflictDetails({ currentVersion: 0 }), {});
  });
});

// Group related unit tests.
describe("canRebaseConflict", () => {
  // Unit test case.
  it("allows version_conflict with currentVersion", () => {
    // Assert expected test outcome.
    assert.equal(
      // Invoke helper or pass arguments.
      canRebaseConflict("version_conflict", { currentVersion: 9 }),
      // List item in import/export/params.
      true,
    );
  });

  // Unit test case.
  it("blocks assignee_conflict even with currentVersion", () => {
    // Assert expected test outcome.
    assert.equal(
      // Invoke helper or pass arguments.
      canRebaseConflict("assignee_conflict", { currentVersion: 9 }),
      // List item in import/export/params.
      false,
    );
  });
});

// Group related unit tests.
describe("shouldTreatForbiddenAsConflict", () => {
  // Unit test case.
  it("detects reassignment messages", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      shouldTreatForbiddenAsConflict(
        // Continue multi-line list/arguments.
        "forbidden",
        // Continue multi-line list/arguments.
        "Task is assigned to another employee",
      ),
      // List item in import/export/params.
      true,
    );
  });

  // Unit test case.
  it("ignores Missing * permission messages", () => {
    // Assert expected test outcome.
    assert.equal(
      // Invoke helper or pass arguments.
      shouldTreatForbiddenAsConflict(undefined, "Missing cleaning.start"),
      // List item in import/export/params.
      false,
    );
  });

  // Unit test case.
  it("still recognizes reassignment when a permission phrase appears later", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      shouldTreatForbiddenAsConflict(
        // List item in import/export/params.
        undefined,
        // Continue multi-line list/arguments.
        "Task was reassigned; Missing cleaning.start is no longer allowed",
      ),
      // List item in import/export/params.
      true,
    );
  });
});

// Group related unit tests.
describe("parseConflictDetails", () => {
  // Unit test case.
  it("parses numeric currentVersion", () => {
    // Local constant binding.
    const d = parseConflictDetails({
      // Field/property in this shape.
      currentVersion: 3,
      // Field/property in this shape.
      assignedEmployeeId: null,
    });
    // Assert expected test outcome.
    assert.equal(d?.currentVersion, 3);
    // Assert expected test outcome.
    assert.equal(d?.assignedEmployeeId, null);
  });
});

// Group related unit tests.
describe("entityIdFromQueued", () => {
  // Unit test case.
  it("prefers body taskId over sessionId, ticketId, and URL", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      entityIdFromQueued("cleaning.start", "/api/tasks/from-url/start", {
        // Field/property in this shape.
        taskId: "task-body",
        // Field/property in this shape.
        sessionId: "sess-body",
        // Field/property in this shape.
        ticketId: "tkt-body",
      }),
      // Continue multi-line list/arguments.
      "task-body",
    );
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      entityIdFromQueued("cleaning.complete", "/api/sessions/from-url/complete", {
        // Field/property in this shape.
        sessionId: "sess-body",
        // Field/property in this shape.
        ticketId: "tkt-body",
      }),
      // Continue multi-line list/arguments.
      "sess-body",
    );
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      entityIdFromQueued("ticket.resolve", "/api/tickets/from-url/resolve", {
        // Field/property in this shape.
        ticketId: "tkt-body",
      }),
      // Continue multi-line list/arguments.
      "tkt-body",
    );
  });

  // Unit test case.
  it("falls through empty-string body fields to URL", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      entityIdFromQueued("cleaning.start", "/api/tasks/task-url/start", {
        // Field/property in this shape.
        taskId: "",
      }),
      // Continue multi-line list/arguments.
      "task-url",
    );
  });

  // Unit test case.
  it("parses cleaning.start task id from URL", () => {
    // Assert expected test outcome.
    assert.equal(
      // Invoke helper or pass arguments.
      entityIdFromQueued("cleaning.start", "/api/tasks/task-9/start", {}),
      // Continue multi-line list/arguments.
      "task-9",
    );
  });

  // Unit test case.
  it("parses cleaning.complete session id from URL", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      entityIdFromQueued(
        // Continue multi-line list/arguments.
        "cleaning.complete",
        // Continue multi-line list/arguments.
        "/api/sessions/sess-9/complete",
        {},
      ),
      // Continue multi-line list/arguments.
      "sess-9",
    );
  });

  // Unit test case.
  it("parses ticket.* ticket id from URL", () => {
    // Assert expected test outcome.
    assert.equal(
      // Invoke helper or pass arguments.
      entityIdFromQueued("ticket.wait", "/api/tickets/tkt-9/wait", {}),
      // Continue multi-line list/arguments.
      "tkt-9",
    );
  });

  // Unit test case.
  it("returns null for missing URL segments or unknown types", () => {
    // Assert expected test outcome.
    assert.equal(entityIdFromQueued("cleaning.start", "/api/other", {}), null);
    // Assert expected test outcome.
    assert.equal(entityIdFromQueued("cleaning.start", "/api/tasks/", {}), null);
    // Assert expected test outcome.
    assert.equal(entityIdFromQueued("unknown.op", "/api/tasks/x", {}), null);
    // Assert expected test outcome.
    assert.equal(entityIdFromQueued("unknown.op", "/api/tickets/x/resolve", {}), null);
  });

  // Unit test case.
  it("ignores non-string body ids and falls through to URL", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      entityIdFromQueued("cleaning.start", "/api/tasks/t1/start", {
        // Field/property in this shape.
        taskId: 123,
      }),
      // Continue multi-line list/arguments.
      "t1",
    );
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      entityIdFromQueued("ticket.start", "/api/tickets/from-url/start", {
        // Field/property in this shape.
        sessionId: 1,
        // Field/property in this shape.
        ticketId: "tkt-1",
      }),
      // Continue multi-line list/arguments.
      "tkt-1",
    );
  });

  // Unit test case.
  it("falls through empty sessionId/ticketId to URL", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      entityIdFromQueued("cleaning.complete", "/api/sessions/s1/complete", {
        // Field/property in this shape.
        sessionId: "",
      }),
      // Continue multi-line list/arguments.
      "s1",
    );
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      entityIdFromQueued("ticket.report", "/api/tickets/tkt-r/report", {
        // Field/property in this shape.
        ticketId: "",
      }),
      // Continue multi-line list/arguments.
      "tkt-r",
    );
  });

  // Unit test case.
  it("ignores query and hash when extracting an id from URL fallback", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      entityIdFromQueued(
        // Continue multi-line list/arguments.
        "cleaning.start",
        // Assign value for subsequent use.
        "https://api.example.test/api/v1/tasks/task-1/start?retry=1#details",
        {},
      ),
      // Continue multi-line list/arguments.
      "task-1",
    );
    // Assert expected test outcome.
    assert.equal(
      // Assign value for subsequent use.
      entityIdFromQueued("ticket.resolve", "/api/maintenance/tickets/t-9/resolve?x=1", {}),
      // Continue multi-line list/arguments.
      "t-9",
    );
    // Assert expected test outcome.
    assert.equal(
      // Invoke helper or pass arguments.
      entityIdFromQueued("cleaning.complete", "/api/tasks/t1/start", {}),
      // List item in import/export/params.
      null,
    );
    // Assert expected test outcome.
    assert.equal(entityIdFromQueued("ticket.resolve", "http://[invalid", {}), null);
  });
});

// Group related unit tests.
describe("additional conflict boundaries", () => {
  // Unit test case.
  it("rejects null and primitive detail payloads", () => {
    // Assert expected test outcome.
    assert.equal(parseConflictDetails(null), null);
    // Assert expected test outcome.
    assert.equal(parseConflictDetails("not details"), null);
  });

  // Unit test case.
  it("keeps only valid detail field types", () => {
    // Assert expected test outcome.
    assert.deepEqual(
      // Open multi-line construct.
      parseConflictDetails({
        // Field/property in this shape.
        expectedVersion: "2",
        // Field/property in this shape.
        currentVersion: 3,
        // Field/property in this shape.
        status: 4,
        // Field/property in this shape.
        assignedEmployeeId: false,
      }),
      // Continue multi-line list/arguments.
      { currentVersion: 3 },
    );
  });

  // Unit test case.
  it("rejects array details instead of treating them as an empty object", () => {
    // Assert expected test outcome.
    assert.equal(parseConflictDetails([]), null);
  });

  // Unit test case.
  it("refuses rebasing out-of-scope conflicts even with a current version", () => {
    // Assert expected test outcome.
    assert.equal(
      // Invoke helper or pass arguments.
      canRebaseConflict("out_of_scope", { currentVersion: 9 }),
      // List item in import/export/params.
      false,
    );
  });

  // Unit test case.
  it("keeps Missing permission errors failed even when a conflict code is present", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      shouldTreatForbiddenAsConflict(
        // Continue multi-line list/arguments.
        "assignee_conflict",
        // Continue multi-line list/arguments.
        "Missing cleaning.start",
      ),
      // List item in import/export/params.
      false,
    );
  });

  // Unit test case.
  it("recognizes the remaining reassignment and scope message forms", () => {
    // Iterate collection / range.
    for (const message of [
      // Continue multi-line list/arguments.
      "This task belongs to another employee",
      // Continue multi-line list/arguments.
      "Outside your permitted locations",
      // Continue multi-line list/arguments.
      "Task is out of scope",
    // Open multi-line construct.
    ]) {
      // Assert expected test outcome.
      assert.equal(shouldTreatForbiddenAsConflict(undefined, message), true);
    }
    // Assert expected test outcome.
    assert.equal(shouldTreatForbiddenAsConflict("unknown", "Forbidden"), false);
  });

  // Unit test case.
  it("recognizes explicit forbidden conflict codes without a message", () => {
    // Assert expected test outcome.
    assert.equal(shouldTreatForbiddenAsConflict("assignee_conflict", undefined), true);
    // Assert expected test outcome.
    assert.equal(shouldTreatForbiddenAsConflict("out_of_scope", undefined), true);
  });

  // Unit test case.
  it("preserves every valid conflict detail for the UI", () => {
    // Assert expected test outcome.
    assert.deepEqual(
      // Open multi-line construct.
      parseConflictDetails({
        // Field/property in this shape.
        expectedVersion: 2,
        // Field/property in this shape.
        currentVersion: 3,
        // Field/property in this shape.
        status: "assigned",
        // Field/property in this shape.
        assignedEmployeeId: "employee-1",
      }),
      {
        // Field/property in this shape.
        expectedVersion: 2,
        // Field/property in this shape.
        currentVersion: 3,
        // Field/property in this shape.
        status: "assigned",
        // Field/property in this shape.
        assignedEmployeeId: "employee-1",
      },
    );
  });

  // Unit test case.
  it("uses the default conflict code when a forbidden reassignment has no code", () => {
    // Assert expected test outcome.
    assert.deepEqual(
      // Open multi-line construct.
      decideSyncResult(
        // Continue multi-line list/arguments.
        { status: "forbidden", message: "Task is assigned to another employee" },
        // Continue multi-line list/arguments.
        0,
        // Continue multi-line list/arguments.
        8,
      ),
      {
        // Field/property in this shape.
        status: "conflict",
        // Field/property in this shape.
        lastError: "Task is assigned to another employee",
        // Field/property in this shape.
        conflictCode: "assignee_conflict",
        // Field/property in this shape.
        conflictMessage: "Task is assigned to another employee",
        // Field/property in this shape.
        conflictDetails: null,
      },
    );
  });

  // Unit test case.
  it("increments retries and switches from pending to failed at the limit", () => {
    // Assert expected test outcome.
    assert.deepEqual(decideSyncResult({ status: "error" }, 1, 3), {
      // Field/property in this shape.
      status: "pending",
      // Field/property in this shape.
      lastError: "error",
      // Field/property in this shape.
      conflictCode: null,
      // Field/property in this shape.
      conflictMessage: null,
      // Field/property in this shape.
      conflictDetails: null,
      // Field/property in this shape.
      retries: 2,
    });
    // Assert expected test outcome.
    assert.equal(decideSyncResult({ status: "error" }, 2, 3).status, "failed");
    // Assert expected test outcome.
    assert.equal(decideSyncResult({ status: "error" }, 2, 3).retries, 3);
  });

  // Unit test case.
  it("uses stable defaults for missing or invalid conflict metadata", () => {
    // Iterate collection / range.
    for (const result of [
      // Continue multi-line list/arguments.
      { status: "conflict" },
      // Continue multi-line list/arguments.
      { status: "conflict", message: 42, code: {}, details: [] },
    // Open multi-line construct.
    ]) {
      // Assert expected test outcome.
      assert.deepEqual(
        // Invoke helper or pass arguments.
        decideSyncResult(result as never, 0, 8),
        {
          // Field/property in this shape.
          status: "conflict",
          // Field/property in this shape.
          lastError: "conflict",
          // Field/property in this shape.
          conflictCode: null,
          // Field/property in this shape.
          conflictMessage: null,
          // Field/property in this shape.
          conflictDetails: null,
        },
      );
    }
  });

  // Unit test case.
  it("uses a fallback code for empty forbidden metadata and counts ACL failures", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      decideSyncResult(
        // Continue multi-line list/arguments.
        { status: "forbidden", code: "", message: "Task was reassigned" },
        // Continue multi-line list/arguments.
        0,
        // Continue multi-line list/arguments.
        8,
      // Continue multi-line list/arguments.
      ).conflictCode,
      // Continue multi-line list/arguments.
      "assignee_conflict",
    );
    // Assert expected test outcome.
    assert.deepEqual(decideSyncResult({ status: "forbidden" }, 2, 8), {
      // Field/property in this shape.
      status: "failed",
      // Field/property in this shape.
      lastError: "forbidden",
      // Field/property in this shape.
      conflictCode: null,
      // Field/property in this shape.
      conflictMessage: null,
      // Field/property in this shape.
      conflictDetails: null,
      // Field/property in this shape.
      retries: 3,
    });
  });
});
