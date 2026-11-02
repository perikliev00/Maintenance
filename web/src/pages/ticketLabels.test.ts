import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { priorityLabel, statusLabel } from "./ticketLabels";

const STATUSES = [
  "new",
  "assigned",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
] as const;

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

describe("ticketLabels", () => {
  it("maps every known status for bg and en", () => {
    const expectedBg: Record<(typeof STATUSES)[number], string> = {
      new: "Нов",
      assigned: "Назначен",
      in_progress: "В работа",
      waiting: "Изчакване",
      resolved: "Решен",
      closed: "Затворен",
    };
    const expectedEn: Record<(typeof STATUSES)[number], string> = {
      new: "New",
      assigned: "Assigned",
      in_progress: "In progress",
      waiting: "Waiting",
      resolved: "Resolved",
      closed: "Closed",
    };
    for (const status of STATUSES) {
      assert.equal(statusLabel("bg", status), expectedBg[status]);
      assert.equal(statusLabel("en", status), expectedEn[status]);
    }
  });

  it("maps every known priority for bg and en", () => {
    const expectedBg: Record<(typeof PRIORITIES)[number], string> = {
      low: "Нисък",
      normal: "Нормален",
      high: "Висок",
      urgent: "Спешен",
    };
    const expectedEn: Record<(typeof PRIORITIES)[number], string> = {
      low: "Low",
      normal: "Normal",
      high: "High",
      urgent: "Urgent",
    };
    for (const priority of PRIORITIES) {
      assert.equal(priorityLabel("bg", priority), expectedBg[priority]);
      assert.equal(priorityLabel("en", priority), expectedEn[priority]);
    }
  });

  it("falls back to the raw value for unknown enums", () => {
    assert.equal(statusLabel("bg", "unknown_status"), "unknown_status");
    assert.equal(priorityLabel("en", "unknown_priority"), "unknown_priority");
  });
});
