/**
 * Admin settings shell: tabbed drafts patched with an optional reason, plus
 * system status and optional issue catalog (`issue_options.manage`).
 *
 * Lifecycles are owned by focused hooks; this component only wires them:
 * - useSettingsServerState: last-known bundle, locale, SLA rows (read side)
 * - useSettingsDraft: draft / reason / dirty / server-conflict rules
 * - useSettingsSave: PATCH with expectedVersion + post-save refresh outcome
 * - useSystemStatus: diagnostics polling; failure only marks stale
 * - useSettingsHistory: timeline tab; failure scoped to that tab
 * - useSlaPolicySave: immediate SLA edits; failure scoped to the SLA block
 * - useSettingsFeedback: error/saved/refresh-warning banners for edits+saves
 */
import { useCallback, useEffect, useState } from "react";
import { canPerformAction, type AuthUser } from "../../api/client";
import { useBusyMutation } from "../../hooks/useBusyMutation";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { IssueCatalogPanel } from "../../components/IssueCatalogPanel";
import { TABS, type Tab } from "./constants";
import {
  SystemStatusSection,
  SystemStatusUnavailable,
} from "./SystemStatusSection";
import { ModulesTab } from "./ModulesTab";
import { FlagsTab } from "./FlagsTab";
import { InterfaceTab } from "./InterfaceTab";
import { OperationsTab } from "./OperationsTab";
import { AccessTab } from "./AccessTab";
import { NotificationsTab } from "./NotificationsTab";
import { HistoryTab } from "./HistoryTab";
import { isEditableTab, SETTINGS_BUNDLE_LIVE_EVENTS } from "./settingsDraftLogic";
import { useSettingsDraft } from "./useSettingsDraft";
import { useSettingsFeedback } from "./useSettingsFeedback";
import { useSettingsHistory } from "./useSettingsHistory";
import { useSettingsSave } from "./useSettingsSave";
import { useSettingsServerState } from "./useSettingsServerState";
import { useSlaPolicySave } from "./useSlaPolicySave";
import { useSystemStatus } from "./useSystemStatus";
import { labelFor } from "../../i18n";

type Props = { user: AuthUser };

export function SettingsPage({ user }: Props) {
  // Gate for the issue-catalog tab.
  const canManageIssues = canPerformAction(user, "issue_options.manage");
  const [tab, setTab] = useState<Tab>("modules");
  const [loading, setLoading] = useState(true);

  // One in-flight mutation at a time across settings saves and SLA edits.
  const mutation = useBusyMutation();
  const { busy } = mutation;

  const feedback = useSettingsFeedback();
  const server = useSettingsServerState();
  const systemStatus = useSystemStatus({ liveEnabled: !loading });
  const history = useSettingsHistory();
  const draftState = useSettingsDraft({
    tab,
    bundle: server.bundle,
    busyRef: mutation.busyRef,
    clearFeedback: feedback.clearOutcome,
  });

  const label = labelFor(server.locale);
  const { dirty } = draftState;

  const { load: loadServer } = server;
  const { applyServerBundle } = draftState;
  /** Load the server snapshot, then let the draft rules decide what to apply. */
  const refreshSettings = useCallback(
    async (opts?: { forceDraft?: boolean }) => {
      applyServerBundle(await loadServer(), opts);
    },
    [loadServer, applyServerBundle],
  );

  const { refresh: refreshSystem } = systemStatus;
  /** Initial / full page load: settings + system together. */
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshSettings({ forceDraft: true }), refreshSystem()]);
  }, [refreshSettings, refreshSystem]);

  const { save } = useSettingsSave({
    tab,
    bundle: server.bundle,
    draft: draftState.draft,
    reason: draftState.reason,
    busy: mutation,
    feedback,
    label,
    refresh: {
      settings: refreshSettings,
      system: refreshSystem,
      history: history.refresh,
    },
    onSaved: draftState.clearReasonAndConflict,
  });

  const { slaError, saveSlaPolicy } = useSlaPolicySave({
    busy: mutation,
    applySlaPolicy: server.applySlaPolicy,
    setMessage: feedback.setMessage,
    label,
  });

  // Live-refresh settings while not in the initial loading state.
  useLiveRefresh(
    () => {
      void refreshSettings();
    },
    {
      enabled: !loading,
      busy,
      eventTypes: [...SETTINGS_BUNDLE_LIVE_EVENTS],
    },
  );

  // Initial load.
  const { setError } = feedback;
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await refreshAll();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshAll, setError]);

  // History is loaded each time its tab opens.
  const { load: loadHistory } = history;
  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  if (loading && !server.bundle) {
    return (
      <main className="content">
        <p className="muted">{label("Зареждане…", "Loading…")}</p>
      </main>
    );
  }

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>{label("Настройки", "Settings")}</h1>
          <p>
            {label(
              "Модули, флагове, операции и системно състояние",
              "Modules, flags, operations and system status",
            )}
          </p>
        </div>
      </header>

      {systemStatus.system && (
        <SystemStatusSection
          system={systemStatus.system}
          label={label}
          stale={systemStatus.stale}
          lastSuccessAt={systemStatus.lastSuccessAt}
        />
      )}
      {!systemStatus.system && systemStatus.stale && (
        <SystemStatusUnavailable
          label={label}
          onRetry={() => void refreshSystem()}
        />
      )}

      <div className="settings-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "nav-tab active" : "nav-tab"}
            disabled={busy}
            onClick={() => setTab(t.id)}
          >
            {server.locale === "bg" ? t.bg : t.en}
          </button>
        ))}
        {canManageIssues && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "issues"}
            className={tab === "issues" ? "nav-tab active" : "nav-tab"}
            disabled={busy}
            onClick={() => setTab("issues")}
          >
            {label("Опции за проблеми", "Issue options")}
          </button>
        )}
      </div>

      {feedback.error && <div className="error banner">{feedback.error}</div>}
      {feedback.message && <div className="ok banner">{feedback.message}</div>}
      {feedback.refreshWarning && (
        <div className="error banner" role="status">
          {label("Записът успя, но опресняването се провали: ", "Saved, but refresh failed: ")}
          {feedback.refreshWarning}
          <button
            type="button"
            className="linkish"
            style={{ marginLeft: "0.75rem" }}
            onClick={() => {
              void (async () => {
                try {
                  await refreshSettings({ forceDraft: !dirty });
                  await refreshSystem();
                  feedback.setRefreshWarning(null);
                } catch (err) {
                  feedback.setRefreshWarning(
                    err instanceof Error ? err.message : "Refresh failed",
                  );
                }
              })();
            }}
          >
            {label("Опресни", "Refresh")}
          </button>
        </div>
      )}
      {draftState.serverConflict && dirty && (
        <div className="error banner" role="status">
          {label(
            "Има по-нова сървърна версия. Черновата ви е запазена — презаредете съзнателно или запишете (може да получите конфликт).",
            "A newer server version exists. Your draft is kept — reload deliberately or save (may conflict).",
          )}
          <button
            type="button"
            style={{ marginLeft: "0.75rem" }}
            disabled={busy}
            onClick={() => {
              void refreshSettings({ forceDraft: true }).then(() => {
                draftState.clearReasonAndConflict();
                feedback.setError(null);
              });
            }}
          >
            {label("Презареди от сървъра", "Reload from server")}
          </button>
        </div>
      )}
      {server.bundle?.[tab]?.valueValid === false && (
        <div className="error banner" role="status">
          {label(
            "Съхранената конфигурация е повредена — показани са стойности по подразбиране.",
            "Stored configuration is corrupt — defaults are shown.",
          )}
        </div>
      )}

      <section className="panel">
        <fieldset
          disabled={busy}
          style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}
        >
          {tab === "modules" && (
            <ModulesTab
              draft={draftState.draft}
              setBool={draftState.setBool}
              label={label}
              disabled={busy}
            />
          )}

          {tab === "flags" && (
            <FlagsTab draft={draftState.draft} setBool={draftState.setBool} />
          )}

          {tab === "interface" && (
            <InterfaceTab
              draft={draftState.draft}
              setDraft={draftState.editDraft}
              label={label}
            />
          )}

          {tab === "operations" && (
            <OperationsTab
              draft={draftState.draft}
              setDraft={draftState.editDraft}
              label={label}
              slaPolicies={server.slaPolicies}
              slaError={slaError}
              onSaveSlaPolicy={(priority, hours) =>
                void saveSlaPolicy(priority, hours)
              }
              disabled={busy}
            />
          )}

          {tab === "access" && (
            <AccessTab
              draft={draftState.draft}
              setDraft={draftState.editDraft}
              label={label}
            />
          )}

          {tab === "notifications" && (
            <NotificationsTab
              draft={draftState.draft}
              setNestedChannel={draftState.setNestedChannel}
              label={label}
            />
          )}
        </fieldset>

        {tab === "issues" && canManageIssues && (
          <IssueCatalogPanel locale={server.locale} />
        )}

        {tab === "history" && (
          <HistoryTab
            history={history.history}
            label={label}
            error={history.historyError}
          />
        )}

        {isEditableTab(tab) && (
          <div className="settings-save">
            <label>
              {label("Причина (опционално)", "Reason (optional)")}
              <input
                value={draftState.reason}
                disabled={busy}
                onChange={(e) => {
                  feedback.setMessage(null);
                  draftState.setReason(e.target.value);
                }}
                placeholder={label("защо се променя", "why this change")}
              />
            </label>
            <button type="button" disabled={busy} onClick={() => void save()}>
              {busy
                ? label("Запис…", "Saving…")
                : label("Запази", "Save")}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
