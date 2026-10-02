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
} from "../api/client";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { IssueCatalogPanel } from "../components/IssueCatalogPanel";
import { canPerformAction } from "../api/client";

type Props = { user: AuthUser };

type Tab =
  | "modules"
  | "flags"
  | "interface"
  | "operations"
  | "access"
  | "notifications"
  | "history"
  | "issues";

const TABS: Array<{ id: Tab; bg: string; en: string }> = [
  { id: "modules", bg: "Модули", en: "Modules" },
  { id: "flags", bg: "Флагове", en: "Flags" },
  { id: "interface", bg: "Интерфейс", en: "Interface" },
  { id: "operations", bg: "Операции", en: "Operations" },
  { id: "access", bg: "Достъп", en: "Access" },
  { id: "notifications", bg: "Известия", en: "Notifications" },
  { id: "history", bg: "Хронология", en: "Timeline" },
];

const MODULE_LABELS: Record<string, string> = {
  rooms: "Стаи",
  common: "Общи части",
  cleaning: "Почистване",
  maintenance: "Поддръжка",
  my_work: "Моите задачи",
  repairs: "Повреди",
  team: "Екип",
  live: "На живо",
  control: "Контрол",
  daily_plan: "Дневен план (Clock)",
  attendance: "Присъствие",
  access_cards: "Карти",
  analytics: "Аналитика",
  audit: "Одит",
};

const FLAG_LABELS: Record<string, string> = {
  require_inspection: "Изисквай инспекция след почистване",
  one_active_session_per_employee: "Една активна сесия на служител",
  allow_reception_reassign: "Рецепция може да преназначава",
  block_room_on_urgent_ticket: "Авто-блок при спешен тикет (резерв)",
  show_overdue_banner: "Показвай overdue банер",
};

export function SettingsPage({ user }: Props) {
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

  const label = (bg: string, en: string) => (locale === "bg" ? bg : en);

  const refresh = useCallback(async () => {
    const [all, sys, policies] = await Promise.all([
      fetchAllSettings(),
      fetchSystemStatus(),
      fetchSlaPolicies().catch(() => [] as SlaPolicyRow[]),
    ]);
    setSlaPolicies(policies);
    setBundle(all);
    setSystem(sys);
    const iface = all.interface?.value as { locale?: "bg" | "en" } | undefined;
    if (iface?.locale) setLocale(iface.locale);
    if (tab !== "history" && tab !== "issues" && all[tab]) {
      setDraft(
        structuredClone(all[tab].value) as Record<string, unknown>,
      );
    }
  }, [tab]);

  useLiveRefresh(refresh, {
    enabled: !loading,
    busy,
    eventTypes: ["settings.changed"],
  });

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  useEffect(() => {
    if (tab === "history") {
      fetchSettingsHistory({ limit: 80 })
        .then(setHistory)
        .catch((err) =>
          setError(err instanceof Error ? err.message : "History failed"),
        );
      return;
    }
    if (tab !== "issues" && bundle?.[tab]) {
      setDraft(
        structuredClone(bundle[tab].value) as Record<string, unknown>,
      );
      setReason("");
    }
  }, [tab, bundle]);

  async function save() {
    if (tab === "history" || tab === "issues") return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await patchSetting(tab, draft, reason.trim() || undefined);
      setMessage(label("Запазено", "Saved"));
      setReason("");
      await refresh();
      const hist = await fetchSettingsHistory({ limit: 80 });
      setHistory(hist);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function setBool(path: string, value: boolean) {
    setDraft((prev) => ({ ...prev, [path]: value }));
  }

  function setNestedChannel(
    channel: string,
    field: "enabled" | "status",
    value: boolean | string,
  ) {
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
        <section className="panel settings-system">
          <h2>{label("Системно състояние", "System status")}</h2>
          <div className="settings-status-grid">
            <div className="stat-card">
              <span className="muted">API</span>
              <strong className={system.api.ok ? "ok-text" : "err-text"}>
                {system.api.ok ? "OK" : "DOWN"}
              </strong>
            </div>
            <div className="stat-card">
              <span className="muted">DB</span>
              <strong className={system.database.ok ? "ok-text" : "err-text"}>
                {system.database.ok
                  ? `OK · ${system.database.pingMs}ms`
                  : "DOWN"}
              </strong>
            </div>
            <div className="stat-card">
              <span className="muted">{label("Стаи", "Rooms")}</span>
              <strong>{system.counts.rooms}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">{label("Общи части", "Common")}</span>
              <strong>{system.counts.commonAreas}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">{label("Отворени тикети", "Open tickets")}</span>
              <strong>{system.counts.openTickets}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">{label("Активни сесии", "Running")}</span>
              <strong>{system.counts.runningSessions}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">v{system.version}</span>
              <strong className="muted" style={{ fontSize: "0.85rem" }}>
                {new Date(system.serverTime).toLocaleString()}
              </strong>
            </div>
          </div>
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
            onClick={() => setTab("issues")}
          >
            {label("Опции за проблеми", "Issue options")}
          </button>
        )}
      </div>

      {error && <div className="error banner">{error}</div>}
      {message && <div className="ok banner">{message}</div>}

      <section className="panel">
        {tab === "modules" && (
          <div className="settings-form">
            <p className="muted">
              {label(
                "Изключените модули се скриват от навигацията (където има панел).",
                "Disabled modules are hidden from navigation where a panel exists.",
              )}
            </p>
            {Object.keys(MODULE_LABELS).map((key) => (
              <label key={key} className="checkbox">
                <input
                  type="checkbox"
                  checked={Boolean((draft as Record<string, boolean>)[key])}
                  onChange={(e) => setBool(key, e.target.checked)}
                />
                {MODULE_LABELS[key]}
              </label>
            ))}
          </div>
        )}

        {tab === "flags" && (
          <div className="settings-form">
            {Object.keys(FLAG_LABELS).map((key) => (
              <label key={key} className="checkbox">
                <input
                  type="checkbox"
                  checked={Boolean((draft as Record<string, boolean>)[key])}
                  onChange={(e) => setBool(key, e.target.checked)}
                />
                {FLAG_LABELS[key]}
              </label>
            ))}
          </div>
        )}

        {tab === "interface" && (
          <div className="settings-form">
            <label>
              {label("Тема по подразбиране", "Default theme")}
              <select
                value={String((draft as { defaultTheme?: string }).defaultTheme ?? "dark")}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, defaultTheme: e.target.value }))
                }
              >
                <option value="dark">dark</option>
                <option value="light">light</option>
              </select>
            </label>
            <label>
              {label("Език", "Locale")}
              <select
                value={String((draft as { locale?: string }).locale ?? "bg")}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, locale: e.target.value }))
                }
              >
                <option value="bg">Български</option>
                <option value="en">English</option>
              </select>
            </label>
            <label>
              {label("Плътност", "Density")}
              <select
                value={String((draft as { density?: string }).density ?? "comfortable")}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, density: e.target.value }))
                }
              >
                <option value="comfortable">comfortable</option>
                <option value="compact">compact</option>
              </select>
            </label>
          </div>
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
                  setDraft((p) => ({ ...p, hotelTimezone: e.target.value }))
                }
              />
            </label>
          </div>
        )}

        {tab === "access" && (
          <div className="settings-form">
            <p className="muted">
              {label(
                "TTL се ползва при издаване на покани. lockInactiveUsers се изпълнява от фонов job (~5 мин).",
                "TTL is used when issuing invitations. lockInactiveUsers runs via background job (~5 min).",
              )}
            </p>
            <label>
              {label("Валидност на код (часове)", "Invitation TTL (hours)")}
              <input
                type="number"
                min={1}
                max={168}
                value={Number(
                  (draft as { invitationTtlHours?: number }).invitationTtlHours ??
                    2,
                )}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    invitationTtlHours: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label>
              {label("Idle дни (инфо)", "Idle days (info)")}
              <input
                type="number"
                min={1}
                max={365}
                value={Number(
                  (draft as { sessionIdleDays?: number }).sessionIdleDays ?? 30,
                )}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    sessionIdleDays: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={Boolean(
                  (draft as { lockInactiveUsers?: boolean }).lockInactiveUsers,
                )}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    lockInactiveUsers: e.target.checked,
                  }))
                }
              />
              {label(
                "Блокирай неактивни (без авто-job)",
                "Lock inactive users (no auto-job)",
              )}
            </label>
          </div>
        )}

        {tab === "notifications" && (
          <div className="settings-form">
            {(["in_app", "device_push", "email"] as const).map((ch) => {
              const channel = (draft[ch] ?? {}) as {
                enabled?: boolean;
                status?: string;
              };
              const isPush = ch === "device_push";
              return (
                <div key={ch} className="settings-channel">
                  <strong>{ch}</strong>
                  <span className="muted">status: {channel.status}</span>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      disabled={isPush}
                      checked={Boolean(channel.enabled) && !isPush}
                      onChange={(e) =>
                        setNestedChannel(ch, "enabled", e.target.checked)
                      }
                    />
                    {label("Активен", "Enabled")}
                    {isPush
                      ? ` (${label("not_configured — няма адаптер", "not_configured — no adapter")})`
                      : ""}
                  </label>
                </div>
              );
            })}
          </div>
        )}

        {tab === "issues" && canManageIssues && (
          <IssueCatalogPanel locale={locale} />
        )}

        {tab === "history" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{label("Време", "Time")}</th>
                  <th>{label("Ключ", "Key")}</th>
                  <th>{label("Актор", "Actor")}</th>
                  <th>{label("Причина", "Reason")}</th>
                  <th>Diff</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      {label("Няма записи", "No entries")}
                    </td>
                  </tr>
                ) : (
                  history.map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.createdAt).toLocaleString()}</td>
                      <td>{row.key}</td>
                      <td>{row.actor.fullName}</td>
                      <td>{row.reason ?? "—"}</td>
                      <td>
                        <code className="diff-mini">
                          {JSON.stringify(row.after).slice(0, 120)}
                          {JSON.stringify(row.after).length > 120 ? "…" : ""}
                        </code>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

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
