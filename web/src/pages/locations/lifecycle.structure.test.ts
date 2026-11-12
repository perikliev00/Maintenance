import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskPriorityDueCell } from "./lifecycle";

type CellProps = Parameters<typeof TaskPriorityDueCell>[0];

// Define function render and its behavior.
function render(props: CellProps): string {
  return renderToStaticMarkup(createElement(TaskPriorityDueCell, props));
}

describe("TaskPriorityDueCell structure", () => {
  it("does not own a table cell wrapper (avoids nested td)", () => {
    const task = {
      priority: "high",
      dueAt: "2026-01-01T10:00:00.000Z",
    } as unknown as CellProps["task"];
    for (const html of [
      render({ task, locale: "en" }),
      render({ task: null, locale: "en" }),
    ]) {
      assert.doesNotMatch(html, /<t[dh][\s>]/);
    }
  });

  it("renders priority and due content for an active task", () => {
    const html = render({
      task: { priority: "high", dueAt: null } as unknown as CellProps["task"],
      locale: "en",
    });
    assert.match(html, /task-priority-due/);
    assert.match(html, /High/);
    assert.match(html, /no due/);
  });

  it("renders a muted placeholder when there is no task", () => {
    assert.equal(
      render({ task: null, locale: "en" }),
      '<span class="muted">—</span>',
    );
  });
});
