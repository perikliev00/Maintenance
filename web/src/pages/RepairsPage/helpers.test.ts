import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isArchivedLocation,
  priorityLabel,
  statusLabel,
  t,
} from "./helpers";
import type { MaintenanceTicket } from "../../api/client";

describe("Repairs helpers localization", () => {
  it("picks BG by default and EN when locale is en", () => {
    assert.equal(t("bg", "Повреди", "Repairs"), "Повреди");
    assert.equal(t("en", "Повреди", "Repairs"), "Repairs");
  });

  it("translates status and priority without changing enum keys", () => {
    assert.equal(statusLabel("bg", "in_progress"), "В работа");
    assert.equal(statusLabel("en", "in_progress"), "In progress");
    assert.equal(priorityLabel("bg", "urgent"), "Спешен");
    assert.equal(priorityLabel("en", "urgent"), "Urgent");
    assert.equal(statusLabel("bg", "unknown_status"), "unknown_status");
  });

  it("detects archived locations from catalogStatus", () => {
    const base = {
      location: {
        id: "1",
        number: "101",
        floor: { number: 1, building: { code: "A", name: "A" } },
      },
    } as MaintenanceTicket;
    assert.equal(isArchivedLocation(base), false);
    assert.equal(
      isArchivedLocation({
        ...base,
        location: { ...base.location, catalogStatus: "archived" },
      }),
      true,
    );
  });
});
