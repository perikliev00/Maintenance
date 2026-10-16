/**
 * Admin settings shell: tabbed drafts patched with a required reason, plus
 * system status and optional issue catalog (`issue_options.manage`).
 * Live-refreshes on `settings.changed` while not busy.
 */
import { useCallback, useEffect, useState } from "react";
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

type Props = { user: AuthUser };

/**
 * Admin settings shell: tabbed drafts patched with a required reason, plus
 * system status and optional issue catalog (`issue_options.manage`).
 */
export function SettingsPage({ user }: Props) {
  // Gate for the issue-catalog tab.
  const canManageIssues = canPerformAction(user, "issue_options.manage");
  const [tab, setTab] = useState<Tab>("modules");
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [history, setHistory] = useState<SettingHistoryRow[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState("");
  const [locale, setLocale] = useState<"bg" | "en">("bg");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [slaPolicies, setSlaPolicies] = useState<SlaPolicyRow[]>([]);

  /** Pick BG vs EN copy for this page. */
  const label = (bg: string, en: string) => (locale === "bg" ? bg : en);

  /** Load settings bundle, system status, and SLA policies. */
  const refresh = useCallback(async () => {
    const [all, sys, policies] = await Promise.all([
      fetchAllSettings(),
      fetchSystemStatus(),
      // Promise catch handler.
      fetchSlaPolicies().catch(() => [] as SlaPolicyRow[]),
    ]);
    // State transition.
    setSlaPolicies(policies);
    // State transition.
    setBundle(all);
    // State transition.
    setSystem(sys);
    // Mirror interface.locale into local UI locale when present.
    const iface = all.interface?.value as { locale?: "bg" | "en" } | undefined;
    // Branch: conditional gate.
    if (iface?.locale) setLocale(iface.locale);
    // Sync draft for editable tabs (not history/issues).
    if (tab !== "history" && tab !== "issues" && all[tab]) {
      // State transition.
      setDraft(
        structuredClone(all[tab].value) as Record<string, unknown>,
      );
    }
  }, [tab]);

  // Live-refresh settings while not in the initial loading/busy state.
  useLiveRefresh(refresh, {
    enabled: !loading,
    busy,
    eventTypes: ["settings.changed"],
  });

  // Initial load.
  useEffect(() => {
    (async () => {
      // Try block for fallible work.
      try {
        // State transition.
        setLoading(true);
        // Await async step.
        await refresh();
      } catch (err) {
        // State transition.
        setError(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        // State transition.
        setLoading(false);
      }
    })();
  }, [refresh]);

  // On tab change: fetch history, or clone the matching draft from the bundle.
  useEffect(() => {
    // Branch: conditional gate.
    if (tab === "history") {
      fetchSettingsHistory({ limit: 80 })
        // Promise then handler.
        .then(setHistory)
        // Promise catch handler.
        .catch((err) =>
          // State transition.
          setError(err instanceof Error ? err.message : "History failed"),
        );
      return;
    }
    // Branch: conditional gate.
    if (tab !== "issues" && bundle?.[tab]) {
      // State transition.
      setDraft(
        structuredClone(bundle[tab].value) as Record<string, unknown>,
      );
      // State transition.
      setReason("");
    }
  }, [tab, bundle]);

  /** Patch the current tab's draft with an optional reason, then refresh. */
  async function save() {
    // History and issues tabs have their own save paths.
    if (tab === "history" || tab === "issues") return;
    // State transition.
    setBusy(true);
    // State transition.
    setError(null);
    // State transition.
    setMessage(null);
    // Try block for fallible work.
    try {
      // Await async step.
      await patchSetting(tab, draft, reason.trim() || undefined);
      // State transition.
      setMessage(label("Запазено", "Saved"));
      // State transition.
      setReason("");
      // Await async step.
      await refresh();
      const hist = await fetchSettingsHistory({ limit: 80 });
      // State transition.
      setHistory(hist);
    } catch (err) {
      // State transition.
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      // State transition.
      setBusy(false);
    }
  }

  /**
   * Helper `setBool`.
   */
  function setBool(path: string, value: boolean) {
    // State transition.
    setDraft((prev) => ({ ...prev, [path]: value }));
  }

  /**
   * Helper `setNestedChannel`.
   */
  function setNestedChannel(
    channel: string,
    field: "enabled" | "status",
    value: boolean | string,
  ) {
    // State transition.
    setDraft((prev) => {
      const cur = { ...((prev[channel] as object) ?? {}) } as Record<
        string,
        unknown
      >;
      cur[field] = value;
      // Branch: conditional gate.
      if (channel === "device_push" && field === "enabled") {
        cur.enabled = false;
        cur.status = "not_configured";
      }
      // Early / value return.
      return { ...prev, [channel]: cur };
    });
  }

  // Branch: conditional gate.
  if (loading && !bundle) {
    // Early / value return.
    return (
      <main className="content">
        <p className="muted">{label("Зареждане…", "Loading…")}</p>
      </main>
    );
  }

  // Early / value return.
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

      {/* Render branch: system && <SystemStatusSection system=system label=label */}
      {system && <SystemStatusSection system={system} label={label} />}

      <div className="settings-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "nav-tab active" : "nav-tab"}
            onClick={() => setTab(t.id)}
          >
            {locale === "bg" ? t.bg : t.en}
          </button>
        ))}
        {/* Render branch: canManageIssues && ( */}
        {canManageIssues && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "issues"}
            className={tab === "issues" ? "nav-tab active" : "nav-tab"}
            onClick={() => setTab("issues")}
          >
            {label("Опции за проблеми", "Issue options")}
          </button>
        )}
      </div>

      {/* Render branch: error && <div className="error banner">error</div> */}
      {error && <div className="error banner">{error}</div>}
      {/* Render branch: message && <div className="ok banner">message</div> */}
      {message && <div className="ok banner">{message}</div>}

      <section className="panel">
        {tab === "modules" && (
          <ModulesTab draft={draft} setBool={setBool} label={label} />
        )}

        {tab === "flags" && <FlagsTab draft={draft} setBool={setBool} />}

        {tab === "interface" && (
          <InterfaceTab draft={draft} setDraft={setDraft} label={label} />
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
                  // State transition.
                  setDraft((p) => ({
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
                  // State transition.
                  setDraft((p) => ({
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
                  // State transition.
                  setDraft((p) => ({
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
                const hours = row?.hours ?? (priority === "urgent" ? 4 : priority === "high" ? 8 : priority === "low" ? 72 : 24);
                // Early / value return.
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
                        // Branch: conditional gate.
                        if (!Number.isFinite(next) || next < 1) return;
                        // State transition.
                        setBusy(true);
                        // State transition.
                        setError(null);
                        // Try block for fallible work.
                        try {
                          const updated = await updateSlaPolicy(priority, {
                            hours: next,
                            isActive: true,
                          });
                          // State transition.
                          setSlaPolicies((prev) => {
                            const others = prev.filter((p) => p.priority !== priority);
                            // Early / value return.
                            return [...others, updated].sort((a, b) =>
                              a.priority.localeCompare(b.priority),
                            );
                          });
                          // State transition.
                          setMessage(
                            label("SLA политиката е записана", "SLA policy saved"),
                          );
                        } catch (err) {
                          // State transition.
                          setError(
                            err instanceof Error ? err.message : "SLA update failed",
                          );
                        } finally {
                          // State transition.
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
                  // State transition.
                  setDraft((p) => ({
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
                  // State transition.
                  setDraft((p) => ({
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
                  // State transition.
                  setDraft((p) => ({ ...p, hotelTimezone: e.target.value }))
                }
              />
            </label>
          </div>
        )}

        {tab === "access" && (
          <AccessTab draft={draft} setDraft={setDraft} label={label} />
        )}

        {tab === "notifications" && (
          <NotificationsTab
            draft={draft}
            setNestedChannel={setNestedChannel}
            label={label}
          />
        )}

        {tab === "issues" && canManageIssues && (
          <IssueCatalogPanel locale={locale} />
        )}

        {tab === "history" && <HistoryTab history={history} label={label} />}

        {tab !== "history" && tab !== "issues" && (
          <div className="settings-save">
            <label>
              {label("Причина (опционално)", "Reason (optional)")}
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={label("защо се променя", "why this change")}
              />
            </label>
            <button type="button" disabled={busy} onClick={save}>
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
