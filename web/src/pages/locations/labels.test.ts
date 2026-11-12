// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  boardT,
  // Support the surrounding logic for this step.
  nextActionLabel,
  // Support the surrounding logic for this step.
  priorityLabel,
  // Support the surrounding logic for this step.
  taskStatusLabel,
// Support the surrounding logic for this step.
} from "./labels";

// Group related tests under a shared suite name.
describe("locations board labels", () => {
  // Define a single test case and its expectation.
  it("localizes task statuses and priorities in BG and EN", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(taskStatusLabel("bg", "assigned"), "Назначена");
    // Invoke assert.equal to perform this step.
    assert.equal(taskStatusLabel("en", "assigned"), "Assigned");
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke taskStatusLabel to perform this step.
      taskStatusLabel("bg", "awaiting_inspection"),
      // Support the surrounding logic for this step.
      "Чака проверка",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(priorityLabel("bg", "normal"), "Нормален");
    // Invoke assert.equal to perform this step.
    assert.equal(priorityLabel("en", "urgent"), "Urgent");
  });

  // Define a single test case and its expectation.
  it("uses zone review wording for common areas", () => {
    // Initialize an object holding related fields.
    const loc = {
      // Provide cleaningStatus field used by this structure.
      cleaningStatus: "verified_clean",
      // Provide readiness field used by this structure.
      readiness: "not_ready",
      // Provide activeTask field used by this structure.
      activeTask: null,
    };
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke nextActionLabel to perform this step.
      nextActionLabel("bg", loc, { isCommon: true }),
      // Support the surrounding logic for this step.
      "Прегледай зоната",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke nextActionLabel to perform this step.
      nextActionLabel("en", loc, { isCommon: true }),
      // Support the surrounding logic for this step.
      "Review zone",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke nextActionLabel to perform this step.
      nextActionLabel("bg", loc, { isCommon: false }),
      // Support the surrounding logic for this step.
      "Прегледай стаята",
    );
  });

  // Define a single test case and its expectation.
  it("keeps create-task hint when dirty without active task", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke nextActionLabel to perform this step.
      nextActionLabel(
        // Support the surrounding logic for this step.
        "bg",
        {
          // Provide cleaningStatus field used by this structure.
          cleaningStatus: "dirty",
          // Provide readiness field used by this structure.
          readiness: "not_ready",
          // Provide activeTask field used by this structure.
          activeTask: null,
        },
        // Support the surrounding logic for this step.
        { isCommon: true },
      ),
      // Support the surrounding logic for this step.
      "Създай задача",
    );
  });

  // Define a single test case and its expectation.
  it("boardT switches by locale", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(boardT("bg", "Зона", "Zone"), "Зона");
    // Invoke assert.equal to perform this step.
    assert.equal(boardT("en", "Зона", "Zone"), "Zone");
  });
});
