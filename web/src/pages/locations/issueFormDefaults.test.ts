// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import type-only dependency for typing without runtime cost.
import type { IssueOptionRow } from "../../api/client";
// Import module dependency from ./issueFormDefaults.
import { buildIssueFormDefaults } from "./issueFormDefaults";

// Initialize an array used by subsequent logic.
const options: IssueOptionRow[] = [
  {
    // Provide id field used by this structure.
    id: "opt-block",
    // Provide nameBg field used by this structure.
    nameBg: "Теч",
    // Provide nameEn field used by this structure.
    nameEn: "Leak",
    // Provide defaultBlocksRoom field used by this structure.
    defaultBlocksRoom: true,
    // Provide defaultPriority field used by this structure.
    defaultPriority: "high",
  // Support the surrounding logic for this step.
  } as IssueOptionRow,
  {
    // Provide id field used by this structure.
    id: "opt-free",
    // Provide nameBg field used by this structure.
    nameBg: "Лампа",
    // Provide nameEn field used by this structure.
    nameEn: "Lamp",
    // Provide defaultBlocksRoom field used by this structure.
    defaultBlocksRoom: false,
    // Provide defaultPriority field used by this structure.
    defaultPriority: "low",
  // Support the surrounding logic for this step.
  } as IssueOptionRow,
];

// Group related tests under a shared suite name.
describe("buildIssueFormDefaults", () => {
  // Define a single test case and its expectation.
  it("applies catalog defaults for the selected option", () => {
    // Bind defaults for use in the following logic.
    const defaults = buildIssueFormDefaults({
      // Provide locale field used by this structure.
      locale: "bg",
      // Provide pickMode field used by this structure.
      pickMode: "option",
      // Support the surrounding logic for this step.
      options,
      // Provide optionId field used by this structure.
      optionId: "opt-block",
      // Provide categoryId field used by this structure.
      categoryId: "cat-1",
    });
    // Invoke assert.equal to perform this step.
    assert.equal(defaults.title, "Теч");
    // Invoke assert.equal to perform this step.
    assert.equal(defaults.blocksRoom, true);
    // Invoke assert.equal to perform this step.
    assert.equal(defaults.priority, "high");
    // Invoke assert.equal to perform this step.
    assert.equal(defaults.optionId, "opt-block");
  });

  // Define a single test case and its expectation.
  it("uses English title when locale is en", () => {
    // Bind defaults for use in the following logic.
    const defaults = buildIssueFormDefaults({
      // Provide locale field used by this structure.
      locale: "en",
      // Provide pickMode field used by this structure.
      pickMode: "option",
      // Support the surrounding logic for this step.
      options,
      // Provide optionId field used by this structure.
      optionId: "opt-free",
      // Provide categoryId field used by this structure.
      categoryId: "cat-1",
    });
    // Invoke assert.equal to perform this step.
    assert.equal(defaults.title, "Lamp");
    // Invoke assert.equal to perform this step.
    assert.equal(defaults.blocksRoom, false);
    // Invoke assert.equal to perform this step.
    assert.equal(defaults.priority, "low");
  });

  // Define a single test case and its expectation.
  it("falls back to the first option when id is missing", () => {
    // Bind defaults for use in the following logic.
    const defaults = buildIssueFormDefaults({
      // Provide locale field used by this structure.
      locale: "bg",
      // Provide pickMode field used by this structure.
      pickMode: "option",
      // Support the surrounding logic for this step.
      options,
      // Provide optionId field used by this structure.
      optionId: "",
      // Provide categoryId field used by this structure.
      categoryId: "cat-1",
    });
    // Invoke assert.equal to perform this step.
    assert.equal(defaults.optionId, "opt-block");
    // Invoke assert.equal to perform this step.
    assert.equal(defaults.blocksRoom, true);
  });

  // Define a single test case and its expectation.
  it("resets custom mode without carrying prior title/blocks", () => {
    // Bind defaults for use in the following logic.
    const defaults = buildIssueFormDefaults({
      // Provide locale field used by this structure.
      locale: "bg",
      // Provide pickMode field used by this structure.
      pickMode: "custom",
      // Support the surrounding logic for this step.
      options,
      // Provide optionId field used by this structure.
      optionId: "opt-block",
      // Provide categoryId field used by this structure.
      categoryId: "cat-1",
    });
    // Invoke assert.equal to perform this step.
    assert.equal(defaults.pickMode, "custom");
    // Invoke assert.equal to perform this step.
    assert.equal(defaults.title, "");
    // Invoke assert.equal to perform this step.
    assert.equal(defaults.blocksRoom, false);
    // Invoke assert.equal to perform this step.
    assert.equal(defaults.priority, "normal");
  });
});
