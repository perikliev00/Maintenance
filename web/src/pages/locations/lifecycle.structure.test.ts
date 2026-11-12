// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency from react.
import { createElement } from "react";
// Import module dependency from react-dom/server.
import { renderToStaticMarkup } from "react-dom/server";
// Import module dependency from ./lifecycle.
import { TaskPriorityDueCell } from "./lifecycle";

// Declare type alias CellProps.
type CellProps = Parameters<typeof TaskPriorityDueCell>[0];

// Define function render and its behavior.
function render(props: CellProps): string {
  // Return early result or rendered output from this path.
  return renderToStaticMarkup(createElement(TaskPriorityDueCell, props));
}

// Group related tests under a shared suite name.
describe("TaskPriorityDueCell structure", () => {
  // Define a single test case and its expectation.
  it("does not own a table cell wrapper (avoids nested td)", () => {
    // Initialize an object holding related fields.
    const task = {
      // Provide priority field used by this structure.
      priority: "high",
      // Provide dueAt field used by this structure.
      dueAt: "2026-01-01T10:00:00.000Z",
    // Support the surrounding logic for this step.
    } as unknown as CellProps["task"];
    // Iterate a collection or counted range.
    for (const html of [
      // Invoke render to perform this step.
      render({ task, locale: "en" }),
      // Invoke render to perform this step.
      render({ task: null, locale: "en" }),
    // Support the surrounding logic for this step.
    ]) {
      // Invoke assert.doesNotMatch to perform this step.
      assert.doesNotMatch(html, /<t[dh][\s>]/);
    }
  });

  // Define a single test case and its expectation.
  it("renders priority and due content for an active task", () => {
    // Bind html for use in the following logic.
    const html = render({
      // Provide task field used by this structure.
      task: { priority: "high", dueAt: null } as unknown as CellProps["task"],
      // Provide locale field used by this structure.
      locale: "en",
    });
    // Invoke assert.match to perform this step.
    assert.match(html, /task-priority-due/);
    // Invoke assert.match to perform this step.
    assert.match(html, /High/);
    // Invoke assert.match to perform this step.
    assert.match(html, /no due/);
  });

  // Define a single test case and its expectation.
  it("renders a muted placeholder when there is no task", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke render to perform this step.
      render({ task: null, locale: "en" }),
      // Support the surrounding logic for this step.
      '<span class="muted">—</span>',
    );
  });
});
