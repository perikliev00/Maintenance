import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taskPriorityDueIsTableCell } from "./lifecycle";

describe("TaskPriorityDueCell structure", () => {
  it("does not own a table cell wrapper (avoids nested td)", () => {
    assert.equal(taskPriorityDueIsTableCell(), false);
  });
});
