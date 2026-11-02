import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiRequestError } from "../../api/http";
import {
  applySettingsBundleRefresh,
  classifySaveError,
  formatStatusCount,
  isDraftDirty,
  mergePostSaveRefresh,
  resolveSaveFlow,
  SETTINGS_BUNDLE_LIVE_EVENTS,
  shouldReplaceDraftOnRefresh,
  SYSTEM_STATUS_LIVE_EVENTS,
} from "./settingsDraftLogic";

describe("settingsDraftLogic", () => {
  it("detects dirty drafts without treating identical clones as dirty", () => {
    const server = { attendance: true, rooms: true };
    assert.equal(isDraftDirty({ ...server }, server), false);
    assert.equal(isDraftDirty({ ...server, attendance: false }, server), true);
  });

  it("refuses to replace a dirty or busy draft on refresh", () => {
    assert.equal(
      shouldReplaceDraftOnRefresh({ dirty: true, busy: false }),
      false,
    );
    assert.equal(
      shouldReplaceDraftOnRefresh({ dirty: false, busy: true }),
      false,
    );
    assert.equal(
      shouldReplaceDraftOnRefresh({ dirty: false, busy: false }),
      true,
    );
  });

  it("SSE refresh keeps dirty draft + reason and marks conflict", () => {
    const draft = { attendance: false };
    const next = { attendance: true };
    const applied = applySettingsBundleRefresh({
      dirty: true,
      busy: false,
      previousServerValue: { attendance: true },
      nextServerValue: next,
      draft,
      reason: "local reason",
    });
    assert.equal(applied.replaced, false);
    assert.equal(applied.serverConflict, true);
    assert.deepEqual(applied.draft, draft);
    assert.equal(applied.reason, "local reason");
  });

  it("clean idle client adopts server draft on settings.changed", () => {
    const applied = applySettingsBundleRefresh({
      dirty: false,
      busy: false,
      previousServerValue: { attendance: true },
      nextServerValue: { attendance: false },
      draft: { attendance: true },
      reason: "",
    });
    assert.equal(applied.replaced, true);
    assert.equal(applied.serverConflict, false);
    assert.deepEqual(applied.draft, { attendance: false });
  });

  it("busy client keeps its draft even when clean, without flagging a conflict", () => {
    const draft = { attendance: true };
    const applied = applySettingsBundleRefresh({
      dirty: false,
      busy: true,
      previousServerValue: { attendance: true },
      nextServerValue: { attendance: false },
      draft,
      reason: "saving",
    });
    assert.equal(applied.replaced, false);
    assert.equal(applied.serverConflict, false);
    assert.deepEqual(applied.draft, draft);
    assert.equal(applied.reason, "saving");
  });

  it("forceDraft replaces a dirty draft and clears the reason", () => {
    const applied = applySettingsBundleRefresh({
      dirty: true,
      busy: true,
      forceDraft: true,
      previousServerValue: { attendance: true },
      nextServerValue: { attendance: false },
      draft: { attendance: true },
      reason: "local reason",
    });
    assert.equal(applied.replaced, true);
    assert.equal(applied.serverConflict, false);
    assert.deepEqual(applied.draft, { attendance: false });
    assert.equal(applied.reason, "");
  });

  it("system refresh events are operational, not settings.changed", () => {
    const bundleEvents: readonly string[] = SETTINGS_BUNDLE_LIVE_EVENTS;
    assert.deepEqual([...SETTINGS_BUNDLE_LIVE_EVENTS], ["settings.changed"]);
    for (const type of SYSTEM_STATUS_LIVE_EVENTS) {
      assert.equal(bundleEvents.includes(type), false);
    }
    const systemEvents: readonly string[] = SYSTEM_STATUS_LIVE_EVENTS;
    assert.equal(systemEvents.includes("settings.changed"), false);
  });

  it("classifies 409 as conflict and network as uncertain", () => {
    const conflict = classifySaveError(
      new ApiRequestError("Setting was updated", {
        kind: "http",
        status: 409,
        code: "version_conflict",
        details: { currentVersion: 4 },
      }),
    );
    assert.equal(conflict.kind, "conflict");
    if (conflict.kind === "conflict") {
      assert.equal(conflict.currentVersion, 4);
    }

    const uncertain = classifySaveError(
      new ApiRequestError("Failed to fetch", { kind: "network" }),
    );
    assert.equal(uncertain.kind, "uncertain");
  });

  it("keeps save success when a follow-up refresh fails", () => {
    assert.deepEqual(
      mergePostSaveRefresh({ saveOk: true, refreshError: "history failed" }),
      { message: "saved", refreshWarning: "history failed" },
    );
    assert.deepEqual(mergePostSaveRefresh({ saveOk: false, refreshError: "x" }), {
      message: null,
      refreshWarning: null,
    });
  });

  it("resolveSaveFlow keeps Saved when history/settings GET fails", () => {
    const ok = resolveSaveFlow({
      patchResult: { ok: true },
      refreshResults: [
        { ok: true },
        { ok: false, message: "history failed" },
        { ok: false, message: "system failed" },
      ],
    });
    assert.equal(ok.mutation, "saved");
    assert.equal(ok.message, "saved");
    assert.equal(ok.error, null);
    assert.match(ok.refreshWarning ?? "", /history failed/);
    assert.equal(ok.keepDraft, false);
  });

  it("failed PATCH does not claim Saved", () => {
    const failed = resolveSaveFlow({
      patchResult: {
        ok: false,
        error: new ApiRequestError("validation", { kind: "http", status: 400 }),
      },
      refreshResults: [],
    });
    assert.equal(failed.mutation, "failed");
    assert.equal(failed.message, null);
    assert.ok(failed.error);
  });

  it("never formats unknown counts as zero", () => {
    assert.equal(formatStatusCount(null), "—");
    assert.equal(formatStatusCount(undefined), "—");
    assert.equal(formatStatusCount(0), "0");
    assert.equal(formatStatusCount(12), "12");
  });
});
