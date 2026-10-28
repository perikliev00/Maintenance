import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IssueOptionRow } from "../../api/client";
import { buildIssueFormDefaults } from "./issueFormDefaults";

const options: IssueOptionRow[] = [
  {
    id: "opt-block",
    nameBg: "Теч",
    nameEn: "Leak",
    defaultBlocksRoom: true,
    defaultPriority: "high",
  } as IssueOptionRow,
  {
    id: "opt-free",
    nameBg: "Лампа",
    nameEn: "Lamp",
    defaultBlocksRoom: false,
    defaultPriority: "low",
  } as IssueOptionRow,
];

describe("buildIssueFormDefaults", () => {
  it("applies catalog defaults for the selected option", () => {
    const defaults = buildIssueFormDefaults({
      locale: "bg",
      pickMode: "option",
      options,
      optionId: "opt-block",
      categoryId: "cat-1",
    });
    assert.equal(defaults.title, "Теч");
    assert.equal(defaults.blocksRoom, true);
    assert.equal(defaults.priority, "high");
    assert.equal(defaults.optionId, "opt-block");
  });

  it("uses English title when locale is en", () => {
    const defaults = buildIssueFormDefaults({
      locale: "en",
      pickMode: "option",
      options,
      optionId: "opt-free",
      categoryId: "cat-1",
    });
    assert.equal(defaults.title, "Lamp");
    assert.equal(defaults.blocksRoom, false);
    assert.equal(defaults.priority, "low");
  });

  it("falls back to the first option when id is missing", () => {
    const defaults = buildIssueFormDefaults({
      locale: "bg",
      pickMode: "option",
      options,
      optionId: "",
      categoryId: "cat-1",
    });
    assert.equal(defaults.optionId, "opt-block");
    assert.equal(defaults.blocksRoom, true);
  });

  it("resets custom mode without carrying prior title/blocks", () => {
    const defaults = buildIssueFormDefaults({
      locale: "bg",
      pickMode: "custom",
      options,
      optionId: "opt-block",
      categoryId: "cat-1",
    });
    assert.equal(defaults.pickMode, "custom");
    assert.equal(defaults.title, "");
    assert.equal(defaults.blocksRoom, false);
    assert.equal(defaults.priority, "normal");
  });
});
