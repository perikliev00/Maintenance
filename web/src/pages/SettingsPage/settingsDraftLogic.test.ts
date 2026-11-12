// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency from ../../api/http.
import { ApiRequestError } from "../../api/http";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  applySettingsBundleRefresh,
  // Support the surrounding logic for this step.
  classifySaveError,
  // Support the surrounding logic for this step.
  formatStatusCount,
  // Support the surrounding logic for this step.
  isDraftDirty,
  // Support the surrounding logic for this step.
  isEditableTab,
  // Support the surrounding logic for this step.
  isTabDraftDirty,
  // Support the surrounding logic for this step.
  mergePostSaveRefresh,
  // Support the surrounding logic for this step.
  patchDraftChannel,
  // Support the surrounding logic for this step.
  resolveSaveFlow,
  // Support the surrounding logic for this step.
  SETTINGS_BUNDLE_LIVE_EVENTS,
  // Support the surrounding logic for this step.
  shouldReplaceDraftOnRefresh,
  // Support the surrounding logic for this step.
  slaHoursForPriority,
  // Support the surrounding logic for this step.
  SYSTEM_STATUS_LIVE_EVENTS,
  // Support the surrounding logic for this step.
  upsertSlaPolicy,
// Support the surrounding logic for this step.
} from "./settingsDraftLogic";

// Group related tests under a shared suite name.
describe("settingsDraftLogic", () => {
  // Define a single test case and its expectation.
  it("detects dirty drafts without treating identical clones as dirty", () => {
    // Initialize an object holding related fields.
    const server = { attendance: true, rooms: true };
    // Invoke assert.equal to perform this step.
    assert.equal(isDraftDirty({ ...server }, server), false);
    // Invoke assert.equal to perform this step.
    assert.equal(isDraftDirty({ ...server, attendance: false }, server), true);
  });

  // Define a single test case and its expectation.
  it("refuses to replace a dirty or busy draft on refresh", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke shouldReplaceDraftOnRefresh to perform this step.
      shouldReplaceDraftOnRefresh({ dirty: true, busy: false }),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke shouldReplaceDraftOnRefresh to perform this step.
      shouldReplaceDraftOnRefresh({ dirty: false, busy: true }),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke shouldReplaceDraftOnRefresh to perform this step.
      shouldReplaceDraftOnRefresh({ dirty: false, busy: false }),
      // Support the surrounding logic for this step.
      true,
    );
  });

  // Define a single test case and its expectation.
  it("SSE refresh keeps dirty draft + reason and marks conflict", () => {
    // Initialize an object holding related fields.
    const draft = { attendance: false };
    // Initialize an object holding related fields.
    const next = { attendance: true };
    // Bind applied for use in the following logic.
    const applied = applySettingsBundleRefresh({
      // Provide dirty field used by this structure.
      dirty: true,
      // Provide busy field used by this structure.
      busy: false,
      // Provide previousServerValue field used by this structure.
      previousServerValue: { attendance: true },
      // Provide nextServerValue field used by this structure.
      nextServerValue: next,
      // Support the surrounding logic for this step.
      draft,
      // Provide reason field used by this structure.
      reason: "local reason",
    });
    // Invoke assert.equal to perform this step.
    assert.equal(applied.replaced, false);
    // Invoke assert.equal to perform this step.
    assert.equal(applied.serverConflict, true);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(applied.draft, draft);
    // Invoke assert.equal to perform this step.
    assert.equal(applied.reason, "local reason");
  });

  // Define a single test case and its expectation.
  it("clean idle client adopts server draft on settings.changed", () => {
    // Bind applied for use in the following logic.
    const applied = applySettingsBundleRefresh({
      // Provide dirty field used by this structure.
      dirty: false,
      // Provide busy field used by this structure.
      busy: false,
      // Provide previousServerValue field used by this structure.
      previousServerValue: { attendance: true },
      // Provide nextServerValue field used by this structure.
      nextServerValue: { attendance: false },
      // Provide draft field used by this structure.
      draft: { attendance: true },
      // Provide reason field used by this structure.
      reason: "",
    });
    // Invoke assert.equal to perform this step.
    assert.equal(applied.replaced, true);
    // Invoke assert.equal to perform this step.
    assert.equal(applied.serverConflict, false);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(applied.draft, { attendance: false });
  });

  // Define a single test case and its expectation.
  it("busy client keeps its draft even when clean, without flagging a conflict", () => {
    // Initialize an object holding related fields.
    const draft = { attendance: true };
    // Bind applied for use in the following logic.
    const applied = applySettingsBundleRefresh({
      // Provide dirty field used by this structure.
      dirty: false,
      // Provide busy field used by this structure.
      busy: true,
      // Provide previousServerValue field used by this structure.
      previousServerValue: { attendance: true },
      // Provide nextServerValue field used by this structure.
      nextServerValue: { attendance: false },
      // Support the surrounding logic for this step.
      draft,
      // Provide reason field used by this structure.
      reason: "saving",
    });
    // Invoke assert.equal to perform this step.
    assert.equal(applied.replaced, false);
    // Invoke assert.equal to perform this step.
    assert.equal(applied.serverConflict, false);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(applied.draft, draft);
    // Invoke assert.equal to perform this step.
    assert.equal(applied.reason, "saving");
  });

  // Define a single test case and its expectation.
  it("forceDraft replaces a dirty draft and clears the reason", () => {
    // Bind applied for use in the following logic.
    const applied = applySettingsBundleRefresh({
      // Provide dirty field used by this structure.
      dirty: true,
      // Provide busy field used by this structure.
      busy: true,
      // Provide forceDraft field used by this structure.
      forceDraft: true,
      // Provide previousServerValue field used by this structure.
      previousServerValue: { attendance: true },
      // Provide nextServerValue field used by this structure.
      nextServerValue: { attendance: false },
      // Provide draft field used by this structure.
      draft: { attendance: true },
      // Provide reason field used by this structure.
      reason: "local reason",
    });
    // Invoke assert.equal to perform this step.
    assert.equal(applied.replaced, true);
    // Invoke assert.equal to perform this step.
    assert.equal(applied.serverConflict, false);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(applied.draft, { attendance: false });
    // Invoke assert.equal to perform this step.
    assert.equal(applied.reason, "");
  });

  // Define a single test case and its expectation.
  it("system refresh events are operational, not settings.changed", () => {
    // Bind bundleEvents for use in the following logic.
    const bundleEvents: readonly string[] = SETTINGS_BUNDLE_LIVE_EVENTS;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual([...SETTINGS_BUNDLE_LIVE_EVENTS], ["settings.changed"]);
    // Iterate a collection or counted range.
    for (const type of SYSTEM_STATUS_LIVE_EVENTS) {
      // Invoke assert.equal to perform this step.
      assert.equal(bundleEvents.includes(type), false);
    }
    // Bind systemEvents for use in the following logic.
    const systemEvents: readonly string[] = SYSTEM_STATUS_LIVE_EVENTS;
    // Invoke assert.equal to perform this step.
    assert.equal(systemEvents.includes("settings.changed"), false);
  });

  // Define a single test case and its expectation.
  it("classifies 409 as conflict and network as uncertain", () => {
    // Bind conflict for use in the following logic.
    const conflict = classifySaveError(
      // Support the surrounding logic for this step.
      new ApiRequestError("Setting was updated", {
        // Provide kind field used by this structure.
        kind: "http",
        // Provide status field used by this structure.
        status: 409,
        // Provide code field used by this structure.
        code: "version_conflict",
        // Provide details field used by this structure.
        details: { currentVersion: 4 },
      }),
    );
    // Invoke assert.equal to perform this step.
    assert.equal(conflict.kind, "conflict");
    // Conditional branch for the case described by this guard.
    if (conflict.kind === "conflict") {
      // Invoke assert.equal to perform this step.
      assert.equal(conflict.currentVersion, 4);
    }

    // Bind uncertain for use in the following logic.
    const uncertain = classifySaveError(
      // Support the surrounding logic for this step.
      new ApiRequestError("Failed to fetch", { kind: "network" }),
    );
    // Invoke assert.equal to perform this step.
    assert.equal(uncertain.kind, "uncertain");
  });

  // Define a single test case and its expectation.
  it("keeps save success when a follow-up refresh fails", () => {
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke mergePostSaveRefresh to perform this step.
      mergePostSaveRefresh({ saveOk: true, refreshError: "history failed" }),
      // Support the surrounding logic for this step.
      { message: "saved", refreshWarning: "history failed" },
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(mergePostSaveRefresh({ saveOk: false, refreshError: "x" }), {
      // Provide message field used by this structure.
      message: null,
      // Provide refreshWarning field used by this structure.
      refreshWarning: null,
    });
  });

  // Define a single test case and its expectation.
  it("resolveSaveFlow keeps Saved when history/settings GET fails", () => {
    // Bind ok for use in the following logic.
    const ok = resolveSaveFlow({
      // Provide patchResult field used by this structure.
      patchResult: { ok: true },
      // Provide refreshResults field used by this structure.
      refreshResults: [
        // Support the surrounding logic for this step.
        { ok: true },
        // Support the surrounding logic for this step.
        { ok: false, message: "history failed" },
        // Support the surrounding logic for this step.
        { ok: false, message: "system failed" },
      ],
    });
    // Invoke assert.equal to perform this step.
    assert.equal(ok.mutation, "saved");
    // Invoke assert.equal to perform this step.
    assert.equal(ok.message, "saved");
    // Invoke assert.equal to perform this step.
    assert.equal(ok.error, null);
    // Invoke assert.match to perform this step.
    assert.match(ok.refreshWarning ?? "", /history failed/);
    // Invoke assert.equal to perform this step.
    assert.equal(ok.keepDraft, false);
  });

  // Define a single test case and its expectation.
  it("failed PATCH does not claim Saved", () => {
    // Bind failed for use in the following logic.
    const failed = resolveSaveFlow({
      // Provide patchResult field used by this structure.
      patchResult: {
        // Provide ok field used by this structure.
        ok: false,
        // Provide error field used by this structure.
        error: new ApiRequestError("validation", { kind: "http", status: 400 }),
      },
      // Provide refreshResults field used by this structure.
      refreshResults: [],
    });
    // Invoke assert.equal to perform this step.
    assert.equal(failed.mutation, "failed");
    // Invoke assert.equal to perform this step.
    assert.equal(failed.message, null);
    // Invoke assert.ok to perform this step.
    assert.ok(failed.error);
  });

  // Define a single test case and its expectation.
  it("never formats unknown counts as zero", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(formatStatusCount(null), "—");
    // Invoke assert.equal to perform this step.
    assert.equal(formatStatusCount(undefined), "—");
    // Invoke assert.equal to perform this step.
    assert.equal(formatStatusCount(0), "0");
    // Invoke assert.equal to perform this step.
    assert.equal(formatStatusCount(12), "12");
  });
});

// Group related tests under a shared suite name.
describe("settings tab draft rules", () => {
  // Define a single test case and its expectation.
  it("only settings-backed tabs are editable", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(isEditableTab("modules"), true);
    // Invoke assert.equal to perform this step.
    assert.equal(isEditableTab("notifications"), true);
    // Invoke assert.equal to perform this step.
    assert.equal(isEditableTab("history"), false);
    // Invoke assert.equal to perform this step.
    assert.equal(isEditableTab("issues"), false);
  });

  // Define a single test case and its expectation.
  it("dirty is false for non-editable tabs and for rows not yet loaded", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(isTabDraftDirty("history", { a: 1 }, { a: 2 }), false);
    // Invoke assert.equal to perform this step.
    assert.equal(isTabDraftDirty("issues", { a: 1 }, { a: 2 }), false);
    // Invoke assert.equal to perform this step.
    assert.equal(isTabDraftDirty("modules", { a: 1 }, undefined), false);
    // Invoke assert.equal to perform this step.
    assert.equal(isTabDraftDirty("modules", { a: 1 }, { a: 1 }), false);
    // Invoke assert.equal to perform this step.
    assert.equal(isTabDraftDirty("modules", { a: 2 }, { a: 1 }), true);
  });

  // Define a single test case and its expectation.
  it("patchDraftChannel edits one field without mutating the draft", () => {
    // Initialize an object holding related fields.
    const draft = { email: { enabled: false, status: "ok" }, other: 1 };
    // Bind next for use in the following logic.
    const next = patchDraftChannel(draft, "email", "enabled", true);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(next, {
      // Provide email field used by this structure.
      email: { enabled: true, status: "ok" },
      // Provide other field used by this structure.
      other: 1,
    });
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(draft.email, { enabled: false, status: "ok" });
  });

  // Define a single test case and its expectation.
  it("patchDraftChannel creates a missing channel", () => {
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(patchDraftChannel({}, "sms", "status", "configured"), {
      // Provide sms field used by this structure.
      sms: { status: "configured" },
    });
  });

  // Define a single test case and its expectation.
  it("device_push can never be enabled from the draft", () => {
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke patchDraftChannel to perform this step.
      patchDraftChannel({}, "device_push", "enabled", true),
      // Support the surrounding logic for this step.
      { device_push: { enabled: false, status: "not_configured" } },
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke patchDraftChannel to perform this step.
      patchDraftChannel(
        // Support the surrounding logic for this step.
        { device_push: { enabled: false, status: "not_configured" } },
        // Support the surrounding logic for this step.
        "device_push",
        // Support the surrounding logic for this step.
        "status",
        // Support the surrounding logic for this step.
        "configured",
      ),
      // Support the surrounding logic for this step.
      { device_push: { enabled: false, status: "configured" } },
    );
  });
});

// Group related tests under a shared suite name.
describe("SLA policy helpers", () => {
  // Bind row for use in the following logic.
  const row = (priority: string, hours: number) => ({
    // Provide id field used by this structure.
    id: priority,
    // Support the surrounding logic for this step.
    priority,
    // Support the surrounding logic for this step.
    hours,
    // Provide isActive field used by this structure.
    isActive: true,
  });

  // Define a single test case and its expectation.
  it("upsert replaces one priority and keeps priority-name order", () => {
    // Bind next for use in the following logic.
    const next = upsertSlaPolicy(
      // Support the surrounding logic for this step.
      [row("urgent", 4), row("low", 72)],
      // Invoke row to perform this step.
      row("high", 6),
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke next.map to perform this step.
      next.map((p) => [p.priority, p.hours]),
      [
        // Support the surrounding logic for this step.
        ["high", 6],
        // Support the surrounding logic for this step.
        ["low", 72],
        // Support the surrounding logic for this step.
        ["urgent", 4],
      ],
    );
    // Bind replaced for use in the following logic.
    const replaced = upsertSlaPolicy(next, row("low", 48));
    // Invoke assert.equal to perform this step.
    assert.equal(replaced.length, 3);
    // Invoke assert.equal to perform this step.
    assert.equal(replaced.find((p) => p.priority === "low")?.hours, 48);
  });

  // Define a single test case and its expectation.
  it("shows built-in defaults when a priority has no row (e.g. SLA load failed)", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(slaHoursForPriority([], "urgent"), 4);
    // Invoke assert.equal to perform this step.
    assert.equal(slaHoursForPriority([], "high"), 8);
    // Invoke assert.equal to perform this step.
    assert.equal(slaHoursForPriority([], "normal"), 24);
    // Invoke assert.equal to perform this step.
    assert.equal(slaHoursForPriority([], "low"), 72);
    // Invoke assert.equal to perform this step.
    assert.equal(slaHoursForPriority([row("high", 6)], "high"), 6);
  });
});
