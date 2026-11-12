import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boardT,
  nextActionLabel,
  priorityLabel,
  taskStatusLabel,
} from "./labels";

describe("locations board labels", () => {
  it("localizes task statuses and priorities in BG and EN", () => {
    assert.equal(taskStatusLabel("bg", "assigned"), "Назначена");
    assert.equal(taskStatusLabel("en", "assigned"), "Assigned");
    assert.equal(
      taskStatusLabel("bg", "awaiting_inspection"),
      "Чака проверка",
    );
    assert.equal(priorityLabel("bg", "normal"), "Нормален");
    assert.equal(priorityLabel("en", "urgent"), "Urgent");
  });

  it("uses zone review wording for common areas", () => {
    const loc = {
      cleaningStatus: "verified_clean",
      readiness: "not_ready",
      activeTask: null,
    };
    assert.equal(
      nextActionLabel("bg", loc, { isCommon: true }),
      "Прегледай зоната",
    );
    assert.equal(
      nextActionLabel("en", loc, { isCommon: true }),
      "Review zone",
    );
    assert.equal(
      nextActionLabel("bg", loc, { isCommon: false }),
      "Прегледай стаята",
    );
  });

  it("keeps create-task hint when dirty without active task", () => {
    assert.equal(
      nextActionLabel(
        "bg",
        {
          cleaningStatus: "dirty",
          readiness: "not_ready",
          activeTask: null,
        },
        { isCommon: true },
      ),
      "Създай задача",
    );
  });

  it("boardT switches by locale", () => {
    assert.equal(boardT("bg", "Зона", "Zone"), "Зона");
    assert.equal(boardT("en", "Зона", "Zone"), "Zone");
  });
});
