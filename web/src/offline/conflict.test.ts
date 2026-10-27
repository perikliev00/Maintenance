import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canRebaseConflict,
  decideSyncResult,
  entityIdFromQueued,
  parseConflictDetails,
  rebaseBodyWithCurrentVersion,
  shouldTreatForbiddenAsConflict,
} from "./conflict";

describe("decideSyncResult", () => {
  it("deletes only on ok", () => {
    assert.equal(decideSyncResult({ status: "ok" }, 0, 8).status, "deleted");
  });

  it("keeps conflict rows with reason and details", () => {
    const patch = decideSyncResult(
      {
        status: "conflict",
        code: "version_conflict",
        message: "Task was updated by another user",
        details: { currentVersion: 4, expectedVersion: 2, status: "assigned" },
      },
      0,
      8,
    );
    assert.equal(patch.status, "conflict");
    assert.equal(patch.conflictCode, "version_conflict");
    assert.equal(patch.conflictMessage, "Task was updated by another user");
    assert.deepEqual(patch.conflictDetails, {
      currentVersion: 4,
      expectedVersion: 2,
      status: "assigned",
    });
  });

  it("maps assignee forbidden to conflict (legacy servers)", () => {
    const patch = decideSyncResult(
      {
        status: "forbidden",
        code: "assignee_conflict",
        message: "Task was reassigned to another employee",
        details: { currentVersion: 3, assignedEmployeeId: "emp-x" },
      },
      0,
      8,
    );
    assert.equal(patch.status, "conflict");
    assert.equal(patch.conflictCode, "assignee_conflict");
  });

  it("keeps true permission denials as failed", () => {
    const patch = decideSyncResult(
      {
        status: "forbidden",
        message: "Missing cleaning.start",
      },
      0,
      8,
    );
    assert.equal(patch.status, "failed");
  });

  it("uses stable fallback text when conflict metadata is absent or blank", () => {
    assert.deepEqual(decideSyncResult({ status: "conflict" }, 0, 8), {
      status: "conflict",
      lastError: "conflict",
      conflictCode: null,
      conflictMessage: null,
      conflictDetails: null,
    });
    assert.equal(
      decideSyncResult({ status: "conflict", message: "   " }, 0, 8).lastError,
      "conflict",
    );
  });

  it("uses an explicit conflict code even when the message is empty", () => {
    const patch = decideSyncResult(
      { status: "forbidden", code: "out_of_scope", message: "" },
      0,
      8,
    );
    assert.equal(patch.status, "conflict");
    assert.equal(patch.lastError, "conflict");
  });

  it("does not treat whitespace-only metadata as meaningful", () => {
    const patch = decideSyncResult(
      { status: "error", code: "  ", message: "   " },
      0,
      8,
    );
    assert.equal(patch.lastError, "error");
    assert.equal(patch.conflictCode, null);
  });

  it("marks permanent validation errors failed without further auto-retry", () => {
    const patch = decideSyncResult(
      {
        status: "error",
        code: "validation",
        message: "Invalid command payload",
        retryable: false,
      },
      0,
      8,
    );
    assert.equal(patch.status, "failed");
    assert.equal(patch.lastError, "Invalid command payload");
  });

  it("keeps temporary failures pending until max retries then fails", () => {
    const mid = decideSyncResult(
      {
        status: "error",
        message: "Temporary command failure",
        retryable: true,
      },
      2,
      8,
    );
    assert.equal(mid.status, "pending");
    assert.equal(mid.retries, 3);
    const last = decideSyncResult(
      {
        status: "error",
        message: "Temporary command failure",
        retryable: true,
      },
      7,
      8,
    );
    assert.equal(last.status, "failed");
    assert.equal(last.retries, 8);
  });
});

describe("rebaseBodyWithCurrentVersion", () => {
  it("rewrites expectedVersion from conflict details", () => {
    const next = rebaseBodyWithCurrentVersion(
      { commandId: "c1", expectedVersion: 2 },
      { currentVersion: 5, expectedVersion: 2 },
    );
    assert.deepEqual(next, { commandId: "c1", expectedVersion: 5 });
  });

  it("returns null when currentVersion missing", () => {
    assert.equal(
      rebaseBodyWithCurrentVersion({ expectedVersion: 1 }, { status: "assigned" }),
      null,
    );
  });

  it("refuses invalid numeric versions that the API cannot accept", () => {
    for (const currentVersion of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(
        rebaseBodyWithCurrentVersion({ expectedVersion: 1 }, { currentVersion }),
        null,
      );
      assert.equal(canRebaseConflict("version_conflict", { currentVersion }), false);
    }
    assert.deepEqual(
      parseConflictDetails({
        expectedVersion: 0,
        currentVersion: Number.MAX_SAFE_INTEGER + 1,
      }),
      {},
    );
    assert.deepEqual(parseConflictDetails({ currentVersion: 0 }), {});
  });
});

describe("canRebaseConflict", () => {
  it("allows version_conflict with currentVersion", () => {
    assert.equal(
      canRebaseConflict("version_conflict", { currentVersion: 9 }),
      true,
    );
  });

  it("blocks assignee_conflict even with currentVersion", () => {
    assert.equal(
      canRebaseConflict("assignee_conflict", { currentVersion: 9 }),
      false,
    );
  });
});

describe("shouldTreatForbiddenAsConflict", () => {
  it("detects reassignment messages", () => {
    assert.equal(
      shouldTreatForbiddenAsConflict(
        "forbidden",
        "Task is assigned to another employee",
      ),
      true,
    );
  });

  it("ignores Missing * permission messages", () => {
    assert.equal(
      shouldTreatForbiddenAsConflict(undefined, "Missing cleaning.start"),
      false,
    );
  });

  it("still recognizes reassignment when a permission phrase appears later", () => {
    assert.equal(
      shouldTreatForbiddenAsConflict(
        undefined,
        "Task was reassigned; Missing cleaning.start is no longer allowed",
      ),
      true,
    );
  });
});

describe("parseConflictDetails", () => {
  it("parses numeric currentVersion", () => {
    const d = parseConflictDetails({
      currentVersion: 3,
      assignedEmployeeId: null,
    });
    assert.equal(d?.currentVersion, 3);
    assert.equal(d?.assignedEmployeeId, null);
  });
});

describe("entityIdFromQueued", () => {
  it("prefers body taskId over sessionId, ticketId, and URL", () => {
    assert.equal(
      entityIdFromQueued("cleaning.start", "/api/tasks/from-url/start", {
        taskId: "task-body",
        sessionId: "sess-body",
        ticketId: "tkt-body",
      }),
      "task-body",
    );
    assert.equal(
      entityIdFromQueued("cleaning.complete", "/api/sessions/from-url/complete", {
        sessionId: "sess-body",
        ticketId: "tkt-body",
      }),
      "sess-body",
    );
    assert.equal(
      entityIdFromQueued("ticket.resolve", "/api/tickets/from-url/resolve", {
        ticketId: "tkt-body",
      }),
      "tkt-body",
    );
  });

  it("falls through empty-string body fields to URL", () => {
    assert.equal(
      entityIdFromQueued("cleaning.start", "/api/tasks/task-url/start", {
        taskId: "",
      }),
      "task-url",
    );
  });

  it("parses cleaning.start task id from URL", () => {
    assert.equal(
      entityIdFromQueued("cleaning.start", "/api/tasks/task-9/start", {}),
      "task-9",
    );
  });

  it("parses cleaning.complete session id from URL", () => {
    assert.equal(
      entityIdFromQueued(
        "cleaning.complete",
        "/api/sessions/sess-9/complete",
        {},
      ),
      "sess-9",
    );
  });

  it("parses ticket.* ticket id from URL", () => {
    assert.equal(
      entityIdFromQueued("ticket.wait", "/api/tickets/tkt-9/wait", {}),
      "tkt-9",
    );
  });

  it("returns null for missing URL segments or unknown types", () => {
    assert.equal(entityIdFromQueued("cleaning.start", "/api/other", {}), null);
    assert.equal(entityIdFromQueued("cleaning.start", "/api/tasks/", {}), null);
    assert.equal(entityIdFromQueued("unknown.op", "/api/tasks/x", {}), null);
    assert.equal(entityIdFromQueued("unknown.op", "/api/tickets/x/resolve", {}), null);
  });

  it("ignores non-string body ids and falls through to URL", () => {
    assert.equal(
      entityIdFromQueued("cleaning.start", "/api/tasks/t1/start", {
        taskId: 123,
      }),
      "t1",
    );
    assert.equal(
      entityIdFromQueued("ticket.start", "/api/tickets/from-url/start", {
        sessionId: 1,
        ticketId: "tkt-1",
      }),
      "tkt-1",
    );
  });

  it("falls through empty sessionId/ticketId to URL", () => {
    assert.equal(
      entityIdFromQueued("cleaning.complete", "/api/sessions/s1/complete", {
        sessionId: "",
      }),
      "s1",
    );
    assert.equal(
      entityIdFromQueued("ticket.report", "/api/tickets/tkt-r/report", {
        ticketId: "",
      }),
      "tkt-r",
    );
  });

  it("ignores query and hash when extracting an id from URL fallback", () => {
    assert.equal(
      entityIdFromQueued(
        "cleaning.start",
        "https://api.example.test/api/v1/tasks/task-1/start?retry=1#details",
        {},
      ),
      "task-1",
    );
    assert.equal(
      entityIdFromQueued("ticket.resolve", "/api/maintenance/tickets/t-9/resolve?x=1", {}),
      "t-9",
    );
    assert.equal(
      entityIdFromQueued("cleaning.complete", "/api/tasks/t1/start", {}),
      null,
    );
    assert.equal(entityIdFromQueued("ticket.resolve", "http://[invalid", {}), null);
  });
});

describe("additional conflict boundaries", () => {
  it("rejects null and primitive detail payloads", () => {
    assert.equal(parseConflictDetails(null), null);
    assert.equal(parseConflictDetails("not details"), null);
  });

  it("keeps only valid detail field types", () => {
    assert.deepEqual(
      parseConflictDetails({
        expectedVersion: "2",
        currentVersion: 3,
        status: 4,
        assignedEmployeeId: false,
      }),
      { currentVersion: 3 },
    );
  });

  it("rejects array details instead of treating them as an empty object", () => {
    assert.equal(parseConflictDetails([]), null);
  });

  it("refuses rebasing out-of-scope conflicts even with a current version", () => {
    assert.equal(
      canRebaseConflict("out_of_scope", { currentVersion: 9 }),
      false,
    );
  });

  it("keeps Missing permission errors failed even when a conflict code is present", () => {
    assert.equal(
      shouldTreatForbiddenAsConflict(
        "assignee_conflict",
        "Missing cleaning.start",
      ),
      false,
    );
  });

  it("recognizes the remaining reassignment and scope message forms", () => {
    for (const message of [
      "This task belongs to another employee",
      "Outside your permitted locations",
      "Task is out of scope",
    ]) {
      assert.equal(shouldTreatForbiddenAsConflict(undefined, message), true);
    }
    assert.equal(shouldTreatForbiddenAsConflict("unknown", "Forbidden"), false);
  });

  it("recognizes explicit forbidden conflict codes without a message", () => {
    assert.equal(shouldTreatForbiddenAsConflict("assignee_conflict", undefined), true);
    assert.equal(shouldTreatForbiddenAsConflict("out_of_scope", undefined), true);
  });

  it("preserves every valid conflict detail for the UI", () => {
    assert.deepEqual(
      parseConflictDetails({
        expectedVersion: 2,
        currentVersion: 3,
        status: "assigned",
        assignedEmployeeId: "employee-1",
      }),
      {
        expectedVersion: 2,
        currentVersion: 3,
        status: "assigned",
        assignedEmployeeId: "employee-1",
      },
    );
  });

  it("uses the default conflict code when a forbidden reassignment has no code", () => {
    assert.deepEqual(
      decideSyncResult(
        { status: "forbidden", message: "Task is assigned to another employee" },
        0,
        8,
      ),
      {
        status: "conflict",
        lastError: "Task is assigned to another employee",
        conflictCode: "assignee_conflict",
        conflictMessage: "Task is assigned to another employee",
        conflictDetails: null,
      },
    );
  });

  it("increments retries and switches from pending to failed at the limit", () => {
    assert.deepEqual(decideSyncResult({ status: "error" }, 1, 3), {
      status: "pending",
      lastError: "error",
      conflictCode: null,
      conflictMessage: null,
      conflictDetails: null,
      retries: 2,
    });
    assert.equal(decideSyncResult({ status: "error" }, 2, 3).status, "failed");
    assert.equal(decideSyncResult({ status: "error" }, 2, 3).retries, 3);
  });

  it("uses stable defaults for missing or invalid conflict metadata", () => {
    for (const result of [
      { status: "conflict" },
      { status: "conflict", message: 42, code: {}, details: [] },
    ]) {
      assert.deepEqual(
        decideSyncResult(result as never, 0, 8),
        {
          status: "conflict",
          lastError: "conflict",
          conflictCode: null,
          conflictMessage: null,
          conflictDetails: null,
        },
      );
    }
  });

  it("uses a fallback code for empty forbidden metadata and counts ACL failures", () => {
    assert.equal(
      decideSyncResult(
        { status: "forbidden", code: "", message: "Task was reassigned" },
        0,
        8,
      ).conflictCode,
      "assignee_conflict",
    );
    assert.deepEqual(decideSyncResult({ status: "forbidden" }, 2, 8), {
      status: "failed",
      lastError: "forbidden",
      conflictCode: null,
      conflictMessage: null,
      conflictDetails: null,
      retries: 3,
    });
  });
});
