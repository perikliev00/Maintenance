/**
 * Admin settings shell: tabbed drafts patched with a required reason, plus
 * system status and optional issue catalog (`issue_options.manage`).
 *
 * Server bundle and local draft are separated so SSE refreshes do not wipe
 * unsaved edits. Saves send expectedVersion (optimistic concurrency). System
 * counts refresh on domain events without touching the draft.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  fetchAllSettings,
  fetchSettingsHistory,
  fetchSlaPolicies,
  fetchSystemStatus,
  patchSetting,
  updateSlaPolicy,
  type AuthUser,
  type SettingHistoryRow,
  type SettingsBundle,
  type SlaPolicyRow,
  type SystemStatus,
} from "../../api/client";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { IssueCatalogPanel } from "../../components/IssueCatalogPanel";
import { canPerformAction } from "../../api/client";
import { TABS, type Tab } from "./constants";
import { SystemStatusSection } from "./SystemStatusSection";
import { ModulesTab } from "./ModulesTab";
import { FlagsTab } from "./FlagsTab";
import { InterfaceTab } from "./InterfaceTab";
import { AccessTab } from "./AccessTab";
import { NotificationsTab } from "./NotificationsTab";
import { HistoryTab } from "./HistoryTab";
import {
  applySettingsBundleRefresh,
  isDraftDirty,
  resolveSaveFlow,
  SETTINGS_BUNDLE_LIVE_EVENTS,
  SYSTEM_STATUS_LIVE_EVENTS,
} from "./settingsDraftLogic";

type Props = { user: AuthUser };

function isEditableTab(tab: Tab): boolean {
  return tab !== "history" && tab !== "issues";
}

/**
 * Admin settings shell: tabbed drafts patched with an optional reason, plus
 * system status and optional issue catalog (`issue_options.manage`).
 */
export function SettingsPage({ user }: Props) {
  // Gate for the issue-catalog tab.
  const canManageIssues = canPerformAction(user, "issue_options.manage");
  const [tab, setTab] = useState<Tab>("modules");
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [systemStale, setSystemStale] = useState(false);
  const [systemSuccessAt, setSystemSuccessAt] = useState<string | null>(null);
  const [history, setHistory] = useState<SettingHistoryRow[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState("");
  const [locale, setLocale] = useState<"bg" | "en">("bg");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [serverConflict, setServerConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [slaPolicies, setSlaPolicies] = useState<SlaPolicyRow[]>([]);

  const draftRef = useRef(draft);
  const bundleRef = useRef(bundle);
  const tabRef = useRef(tab);
  const busyRef = useRef(busy);
  const systemRevisionRef = useRef(0);
  draftRef.current = draft;
  bundleRef.current = bundle;
  tabRef.current = tab;
  busyRef.current = busy;

  /** Pick BG vs EN copy for this page. */
  const label = (bg: string, en: string) => (locale === "bg" ? bg : en);

  const currentServerValue = bundle?.[tab]?.value;
  const dirty =
    isEditableTab(tab) && isDraftDirty(draft, currentServerValue ?? draft);

  /** Load settings bundle (+ SLA) without clobbering a dirty draft. */
  const refreshSettings = useCallback(async (opts?: { forceDraft?: boolean }) => {
    const [all, policies] = await Promise.all([
      fetchAllSettings(),
      fetchSlaPolicies().catch(() => [] as SlaPolicyRow[]),
    ]);
    setSlaPolicies(policies);
    setBundle(all);
    const iface = all.interface?.value as { locale?: "bg" | "en" } | undefined;
    if (iface?.locale) setLocale(iface.locale);

    const activeTab = tabRef.current;
    if (!isEditableTab(activeTab) || !all[activeTab]) return;

    const previous = bundleRef.current?.[activeTab]?.value;
    const localDirty = isDraftDirty(draftRef.current, previous);
    const applied = applySettingsBundleRefresh({
      dirty: localDirty,
      busy: busyRef.current,
      forceDraft: opts?.forceDraft,
      previousServerValue: previous,
      nextServerValue: all[activeTab].value,
      draft: draftRef.current,
      reason: "",
    });
    if (applied.replaced) {
      setDraft(applied.draft as Record<string, unknown>);
    }
    setServerConflict(applied.serverConflict);
  }, []);

  /** Refresh diagnostics only — never touches draft / reason. */
  const refreshSystem = useCallback(async () => {
    const mine = ++systemRevisionRef.current;
    try {
      const sys = await fetchSystemStatus();
      if (mine !== systemRevisionRef.current) return;
      setSystem(sys);
      setSystemSuccessAt(sys.fetchedAt ?? sys.serverTime);
      setSystemStale(false);
    } catch {
      if (mine !== systemRevisionRef.current) return;
      setSystemStale(true);
    }
  }, []);

  /** Initial / full page load: settings + system together. */
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshSettings({ forceDraft: true }), refreshSystem()]);
  }, [refreshSettings, refreshSystem]);

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

  // Event-driven system counts (tickets / cleaning / locations).
  useLiveRefresh(
    () => {
      void refreshSystem();
    },
    {
      enabled: !loading,
      busy: false,
      eventTypes: [...SYSTEM_STATUS_LIVE_EVENTS],
      debounceMs: 600,
    },
  );

  // Initial load.
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
  }, [refreshAll]);

  // On tab change only (not bundle): clone draft so SSE updates cannot wipe edits.
  useEffect(() => {
    if (tab === "history") {
      fetchSettingsHistory({ limit: 80 })
        .then(setHistory)
        .catch((err) =>
          setError(err instanceof Error ? err.message : "History failed"),
        );
      return;
    }
    const row = bundleRef.current?.[tab];
    if (isEditableTab(tab) && row) {
      setDraft(structuredClone(row.value) as Record<string, unknown>);
      setReason("");
      setServerConflict(false);
      setMessage(null);
      setRefreshWarning(null);
    }
  }, [tab]);

  /** Patch the current tab's draft with CAS version, then best-effort refresh. */
  async function save() {
    if (!isEditableTab(tab)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    setRefreshWarning(null);
    const expectedVersion = bundle?.[tab]?.version;
    const refreshResults: Array<{ ok: true } | { ok: false; message: string }> =
      [];
    let patchResult: { ok: true } | { ok: false; error: unknown } = {
      ok: false,
      error: new Error("save aborted"),
    };
    try {
      try {
        await patchSetting(
          tab,
          draft,
          reason.trim() || undefined,
          expectedVersion,
        );
        patchResult = { ok: true };
      } catch (err) {
        patchResult = { ok: false, error: err };
      }

      if (patchResult.ok) {
        try {
          await refreshSettings({ forceDraft: true });
          refreshResults.push({ ok: true });
        } catch (err) {
          refreshResults.push({
            ok: false,
            message:
              err instanceof Error ? err.message : "settings refresh failed",
          });
        }
        try {
          await refreshSystem();
          refreshResults.push({ ok: true });
        } catch (err) {
          refreshResults.push({
            ok: false,
            message:
              err instanceof Error ? err.message : "system refresh failed",
          });
        }
        try {
          const hist = await fetchSettingsHistory({ limit: 80 });
          setHistory(hist);
          refreshResults.push({ ok: true });
        } catch (err) {
          refreshResults.push({
            ok: false,
            message: err instanceof Error ? err.message : "history failed",
          });
        }
      } else if (
        patchResult.error &&
        typeof patchResult.error === "object" &&
        "status" in patchResult.error &&
        (patchResult.error as { status?: number }).status === 409
      ) {
        try {
          await refreshSettings();
        } catch {
          /* keep draft; conflict banner already set */
        }
      }

      const flow = resolveSaveFlow({ patchResult, refreshResults });
      if (flow.mutation === "saved") {
        setMessage(label("Запазено", "Saved"));
        if (!flow.keepReason) setReason("");
        setServerConflict(false);
        setRefreshWarning(
          flow.refreshWarning
            ? label(
                `Записът успя, но опресняването се провали: ${flow.refreshWarning}`,
                `Saved, but refresh failed: ${flow.refreshWarning}`,
              )
            : null,
        );
      } else if (flow.mutation === "conflict") {
        setError(
          label(
            "Конфликт: друг потребител вече е променил тази настройка. Черновата е запазена.",
            "Conflict: another user changed this setting. Your draft is kept.",
          ),
        );
      } else if (flow.mutation === "uncertain") {
        setError(
          label(
            "Мрежова грешка при запис — резултатът е неизвестен. Проверете преди повторен опит.",
            "Network error while saving — outcome unknown. Check before retrying.",
          ),
        );
      } else {
        setError(flow.error);
      }
    } finally {
      setBusy(false);
    }
  }

  function setBool(path: string, value: boolean) {
    setMessage(null);
    setRefreshWarning(null);
    setDraft((prev) => ({ ...prev, [path]: value }));
  }

  function setNestedChannel(
    channel: string,
    field: "enabled" | "status",
    value: boolean | string,
  ) {
    setMessage(null);
    setRefreshWarning(null);
    setDraft((prev) => {
      const cur = { ...((prev[channel] as object) ?? {}) } as Record<
        string,
        unknown
      >;
      cur[field] = value;
      if (channel === "device_push" && field === "enabled") {
        cur.enabled = false;
        cur.status = "not_configured";
      }
      return { ...prev, [channel]: cur };
    });
  }

  const setDraftTracked: Dispatch<SetStateAction<Record<string, unknown>>> = (
    action,
  ) => {
    setMessage(null);
    setRefreshWarning(null);
    setDraft(action);
  };

  if (loading && !bundle) {
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

      {system && (
        <SystemStatusSection
          system={system}
          label={label}
          stale={systemStale}
          lastSuccessAt={systemSuccessAt}
        />
      )}
      {!system && systemStale && (
        <section className="panel settings-system">
          <h2>{label("Системно състояние", "System status")}</h2>
          <p className="error">
            {label(
              "Диагностиката е недостъпна (вероятно проблем с базата или сесията).",
              "Diagnostics unavailable (likely database or session failure).",
            )}
          </p>
          <button type="button" onClick={() => void refreshSystem()}>
            {label("Опитай отново", "Retry")}
          </button>
        </section>
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
            {locale === "bg" ? t.bg : t.en}
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

      {error && <div className="error banner">{error}</div>}
      {message && <div className="ok banner">{message}</div>}
      {refreshWarning && (
        <div className="error banner" role="status">
          {label("Записът успя, но опресняването се провали: ", "Saved, but refresh failed: ")}
          {refreshWarning}
          <button
            type="button"
            className="linkish"
            style={{ marginLeft: "0.75rem" }}
            onClick={() => {
              void (async () => {
                try {
                  await refreshSettings({ forceDraft: !dirty });
                  await refreshSystem();
                  setRefreshWarning(null);
                } catch (err) {
                  setRefreshWarning(
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
      {serverConflict && dirty && (
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
                setReason("");
                setServerConflict(false);
                setError(null);
              });
            }}
          >
            {label("Презареди от сървъра", "Reload from server")}
          </button>
        </div>
      )}
      {bundle?.[tab]?.valueValid === false && (
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
              draft={draft}
              setBool={setBool}
              label={label}
              disabled={busy}
            />
          )}

          {tab === "flags" && <FlagsTab draft={draft} setBool={setBool} />}

          {tab === "interface" && (
            <InterfaceTab draft={draft} setDraft={setDraftTracked} label={label} />
          )}

          {tab === "operations" && (
            <div className="settings-form">
              <label>
                {label("Overdue праг (минути)", "Overdue threshold (minutes)")}
                <input
                  type="number"
                  min={15}
                  max={1440}
                  value={Number(
                    (draft as { overdueSessionMinutes?: number })
                      .overdueSessionMinutes ?? 240,
                  )}
                  onChange={(e) =>
                    setDraftTracked((p) => ({
                      ...p,
                      overdueSessionMinutes: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                {label("Срок на задача по подразбиране (часове)", "Default task due (hours)")}
                <input
                  type="number"
                  min={1}
                  max={72}
                  value={Number(
                    (draft as { defaultTaskDueHours?: number })
                      .defaultTaskDueHours ?? 4,
                  )}
                  onChange={(e) =>
                    setDraftTracked((p) => ({
                      ...p,
                      defaultTaskDueHours: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                {label("SLA на тикет (часове)", "Default ticket SLA (hours)")}
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={Number(
                    (draft as { defaultTicketSlaHours?: number })
                      .defaultTicketSlaHours ?? 24,
                  )}
                  onChange={(e) =>
                    setDraftTracked((p) => ({
                      ...p,
                      defaultTicketSlaHours: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <div className="settings-block">
                <h3>{label("SLA по приоритет", "SLA by priority")}</h3>
                <p className="muted">
                  {label(
                    "Часове до resolve при създаване на тикет. Промяната не мести вече отворени срокове.",
                    "Hours to resolve when a ticket is created. Changes do not rewrite open due dates.",
                  )}
                </p>
                {(["low", "normal", "high", "urgent"] as const).map((priority) => {
                  const row = slaPolicies.find((p) => p.priority === priority);
                  const hours =
                    row?.hours ??
                    (priority === "urgent"
                      ? 4
                      : priority === "high"
                        ? 8
                        : priority === "low"
                          ? 72
                          : 24);
                  return (
                    <label key={priority}>
                      {priority}
                      <input
                        type="number"
                        min={1}
                        max={168}
                        value={hours}
                        disabled={busy}
                        onChange={async (e) => {
                          const next = Number(e.target.value);
                          if (!Number.isFinite(next) || next < 1) return;
                          setBusy(true);
                          setError(null);
                          try {
                            const updated = await updateSlaPolicy(priority, {
                              hours: next,
                              isActive: true,
                            });
                            setSlaPolicies((prev) => {
                              const others = prev.filter((p) => p.priority !== priority);
                              return [...others, updated].sort((a, b) =>
                                a.priority.localeCompare(b.priority),
                              );
                            });
                            setMessage(
                              label("SLA политиката е записана", "SLA policy saved"),
                            );
                          } catch (err) {
                            setError(
                              err instanceof Error ? err.message : "SLA update failed",
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
                      />
                    </label>
                  );
                })}
              </div>
              <label>
                {label("Праг за рискова стая (тикети)", "Risk room ticket threshold")}
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={Number(
                    (draft as { riskTicketThreshold?: number })
                      .riskTicketThreshold ?? 2,
                  )}
                  onChange={(e) =>
                    setDraftTracked((p) => ({
                      ...p,
                      riskTicketThreshold: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                {label("Прозорец за риск (дни)", "Risk window (days)")}
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={Number(
                    (draft as { riskWindowDays?: number }).riskWindowDays ?? 30,
                  )}
                  onChange={(e) =>
                    setDraftTracked((p) => ({
                      ...p,
                      riskWindowDays: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                {label("Часова зона на хотела", "Hotel timezone")}
                <input
                  value={String(
                    (draft as { hotelTimezone?: string }).hotelTimezone ??
                      "Europe/Sofia",
                  )}
                  onChange={(e) =>
                    setDraftTracked((p) => ({ ...p, hotelTimezone: e.target.value }))
                  }
                />
              </label>
            </div>
          )}

          {tab === "access" && (
            <AccessTab draft={draft} setDraft={setDraftTracked} label={label} />
          )}

          {tab === "notifications" && (
            <NotificationsTab
              draft={draft}
              setNestedChannel={setNestedChannel}
              label={label}
            />
          )}
        </fieldset>

        {tab === "issues" && canManageIssues && (
          <IssueCatalogPanel locale={locale} />
        )}

        {tab === "history" && <HistoryTab history={history} label={label} />}

        {isEditableTab(tab) && (
          <div className="settings-save">
            <label>
              {label("Причина (опционално)", "Reason (optional)")}
              <input
                value={reason}
                disabled={busy}
                onChange={(e) => {
                  setMessage(null);
                  setReason(e.target.value);
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
