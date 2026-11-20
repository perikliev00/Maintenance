/**
 * Role permission matrix editor (panels + actions) with change history.
 * Only roles in `editableRoles` can be toggled; saves require a per-role reason.
 * After save, refreshes `fetchMe` so the caller's nav/grants update immediately.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiRequestError,
  ROLE_LABELS,
  fetchMe,
  fetchPermissionHistory,
  fetchPermissionMatrix,
  putRoleGrants,
  type AuthUser,
  type PermissionHistoryRow,
  type PermissionMatrix,
  type Role,
} from "../api/client";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { SectionNav, Surface, Workspace, WorkspaceIntro } from "../ui";
import {
  applySavedRoleToDraft,
  historyStatusFromResult,
  isRoleConflict,
  reconcileMatrixIntoDraft,
  saveFeedbackForDraftConflict,
  type HistoryUiStatus,
  type RoleBases,
  type RoleGrantDraft,
  type SaveFeedback,
} from "./permissionsPageState";
import {
  beginPermissionsSave,
  endPermissionsSave,
  runPermissionsSave,
} from "./permissionsSaveFlow";

type Props = {
  user: AuthUser;
  onUserUpdated?: (user: AuthUser) => void;
};

type Tab = "panels" | "actions" | "history";

const GRANT_LABELS: Record<string, string> = {
  mywork: "Моите задачи", repairs: "Ремонти", home: "Обзор", rooms: "Стаи", common: "Общи части", team: "Екип", live: "Текуща работа", plan: "Дневен план", attendance: "Присъствие", cards: "Карти за достъп", results: "Резултати", analytics: "Аналитика", cleaning: "Организация на почистването", audit: "Дневник", control: "Оперативни решения", settings: "Настройки", permissions: "Политики за достъп", notifications: "Известия",
  "rooms.view": "Преглежда помещения", "rooms.mark_dirty": "Маркира за почистване", "rooms.manage": "Управлява каталога на помещенията", "rooms.set_occupancy": "Променя заетостта", "rooms.set_service_status": "Променя експлоатационния статус",
  "cleaning.create": "Създава задачи за почистване", "cleaning.start": "Започва почистване", "cleaning.complete": "Приключва почистване", "cleaning.inspect": "Одобрява или връща за доработка", "cleaning.reassign": "Преназначава почистване", "cleaning.review_overdue": "Преглежда просрочени сесии", "cleaning.results_view": "Преглежда резултати от почистване",
  "operations.view_live": "Следи текущата работа", "tickets.report": "Докладва проблеми", "tickets.resolve": "Работи по и решава проблеми", "tickets.assign": "Назначава ремонт", "tickets.close": "Потвърждава приключени ремонти",
  "people.view": "Преглежда екипа", "people.change_role": "Променя ролите", "people.invite": "Издава покани", "people.manage_access": "Управлява достъпа и устройствата", "control.access": "Отваря оперативните решения", "settings.manage": "Управлява настройките", "permissions.manage": "Управлява правата",
  "plan.view": "Преглежда дневния план", "plan.manage": "Променя дневния план", "attendance.view": "Преглежда присъствието", "attendance.ingest": "Приема записи за присъствие", "attendance.request_adjustment": "Заявява корекция на присъствие", "attendance.approve_adjustment": "Одобрява корекции на присъствие",
  "cards.view": "Преглежда картите", "cards.issue": "Издава карти", "cards.revoke": "Отменя карти", "analytics.view": "Преглежда аналитиката", "sectors.manage": "Управлява секторите", "sectors.transfer_cross": "Прехвърля между сектори", "shifts.manage": "Управлява смените", "issue_options.manage": "Управлява каталога на проблемите", "audit.view": "Преглежда дневника", "jobs.view": "Преглежда системни задачи", "jobs.run": "Стартира системни задачи",
};

/**
 * Role permission matrix editor (panels + actions) with change history.
 * Only roles in `editableRoles` can be toggled; saves require a per-role reason.
 */
export function PermissionsPage({ user, onUserUpdated }: Props) {
  const [tab, setTab] = useState<Tab>("panels");
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  // Draft values plus the server snapshot/version each role draft started from.
  const [editor, setEditor] = useState<{
    draft: Record<string, RoleGrantDraft>;
    bases: RoleBases;
  }>({ draft: {}, bases: {} });
  const { draft, bases } = editor;
  const setDraft = useCallback(
    (
      update: (
        prev: Record<string, RoleGrantDraft>,
      ) => Record<string, RoleGrantDraft>,
    ) => setEditor((e) => ({ ...e, draft: update(e.draft) })),
    [],
  );
  const [reasonByRole, setReasonByRole] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<PermissionHistoryRow[]>([]);
  const [historyStatus, setHistoryStatus] = useState<HistoryUiStatus>("idle");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null);
  const [savingRoles, setSavingRoles] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const savingRolesRef = useRef<Set<string>>(new Set());

  /** Dirty drafts keep their own baseVersion; remote changes surface as conflicts. */
  const applyMatrix = useCallback((data: PermissionMatrix) => {
    setMatrix(data);
    setEditor((e) =>
      reconcileMatrixIntoDraft(e.draft, e.bases, data),
    );
  }, []);

  /** Full matrix load; never discards local edits (conflicts are flagged instead). */
  const refresh = useCallback(async () => {
    const data = await fetchPermissionMatrix();
    applyMatrix(data);
    return data;
  }, [applyMatrix]);

  /** Explicit reconcile: drop the local draft for `role` and adopt the remote one. */
  function acceptRemote(role: string) {
    if (!matrix || savingRolesRef.current.has(role)) return;
    setEditor((e) => reconcileMatrixIntoDraft(e.draft, e.bases, matrix, role));
    setFeedback(null);
  }

  const conflictRoles = new Set<string>(
    (matrix?.roles ?? []).filter((r) =>
      isRoleConflict(bases[r], matrix?.versions?.[r]),
    ),
  );

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load matrix");
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  useEffect(() => {
    if (tab !== "history") return;
    let cancelled = false;
    setHistoryStatus("loading");
    setHistoryError(null);
    fetchPermissionHistory({ limit: 100 })
      .then((rows) => {
        if (cancelled) return;
        setHistory(rows);
        setHistoryStatus(historyStatusFromResult(true, rows.length));
      })
      .catch((err) => {
        if (cancelled) return;
        setHistoryError(
          err instanceof Error ? err.message : "History failed",
        );
        setHistoryStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const editableSet = useMemo(
    () => new Set(matrix?.editableRoles ?? []),
    [matrix],
  );

  function toggle(role: string, kind: "panels" | "actions", key: string) {
    if (!editableSet.has(role as Exclude<Role, "owner">)) return;
    if (savingRolesRef.current.has(role)) return;
    setDraft((prev) => {
      const cur = prev[role] ?? { panels: [], actions: [] };
      const list = new Set(cur[kind]);
      if (list.has(key)) list.delete(key);
      else list.add(key);

      if (kind === "actions" && key === "permissions.manage") {
        const panels = new Set(cur.panels);
        if (list.has("permissions.manage")) panels.add("permissions");
        else panels.delete("permissions");
        return {
          ...prev,
          [role]: { panels: [...panels], actions: [...list] },
        };
      }
      if (kind === "panels" && key === "permissions") {
        const actions = new Set(cur.actions);
        if (list.has("permissions")) actions.add("permissions.manage");
        else actions.delete("permissions.manage");
        return {
          ...prev,
          [role]: { panels: [...list], actions: [...actions] },
        };
      }

      return {
        ...prev,
        [role]: { ...cur, [kind]: [...list] },
      };
    });
  }

  async function reloadHistoryIfVisible() {
    if (tab !== "history") return;
    setHistoryStatus("loading");
    setHistoryError(null);
    try {
      const rows = await fetchPermissionHistory({ limit: 100 });
      setHistory(rows);
      setHistoryStatus(historyStatusFromResult(true, rows.length));
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "History failed");
      setHistoryStatus("error");
    }
  }

  async function saveRole(role: string) {
    const body = draft[role];
    if (!body) return;
    const roleLabel = ROLE_LABELS[role as Role] ?? role;
    // Never save an old draft under a newer remote version.
    if (conflictRoles.has(role)) {
      setFeedback(saveFeedbackForDraftConflict(roleLabel));
      return;
    }

    const started = beginPermissionsSave(savingRolesRef.current, role);
    if (!started) return;
    savingRolesRef.current = started;
    setSavingRoles(new Set(savingRolesRef.current));
    setError(null);
    setFeedback(null);

    try {
      const outcome = await runPermissionsSave(
        {
          role,
          roleLabel,
          draft: body,
          expectedVersion: bases[role]?.version,
          reason: reasonByRole[role]?.trim() || undefined,
          savingRoles: new Set(), // already gated via beginPermissionsSave
        },
        {
          put: async ({ role: r, panels, actions, expectedVersion, reason }) =>
            putRoleGrants(r as Role, panels, actions, expectedVersion, reason),
          refreshAfterSave: async () => {
            if (user.role === role || user.role === "owner") {
              const me = await fetchMe();
              onUserUpdated?.(me);
            }
            await reloadHistoryIfVisible();
          },
          reloadOnConflict: async () => {
            // Keeps the draft; the role is now flagged as conflicting.
            await refresh();
          },
          isConflictError: (err) =>
            err instanceof ApiRequestError && err.status === 409,
        },
      );

      if (outcome.skipped) {
        setFeedback(outcome.feedback);
        return;
      }

      if (outcome.saved) {
        const result = outcome.saved;
        setEditor((e) => ({
          draft: applySavedRoleToDraft(e.draft, role, {
            panels: result.panels,
            actions: result.actions,
          }),
          bases: {
            ...e.bases,
            [role]: {
              version: result.version,
              grants: {
                panels: [...result.panels],
                actions: [...result.actions],
              },
            },
          },
        }));
        setMatrix((prev) =>
          prev
            ? {
                ...prev,
                byRole: {
                  ...prev.byRole,
                  [role]: {
                    panels:
                      result.panels as PermissionMatrix["byRole"][string]["panels"],
                    actions:
                      result.actions as PermissionMatrix["byRole"][string]["actions"],
                  },
                },
                versions: { ...prev.versions, [role]: result.version },
              }
            : prev,
        );
        setReasonByRole((r) => ({ ...r, [role]: "" }));
      }
      setFeedback(outcome.feedback);
    } finally {
      savingRolesRef.current = endPermissionsSave(savingRolesRef.current, role);
      setSavingRoles(new Set(savingRolesRef.current));
    }
  }

  if (loading && !matrix) {
    return (
      <main className="content">
        <LoadingIndicator label="Зареждане на матрицата…" />
      </main>
    );
  }

  if (!matrix) {
    return (
      <main className="content">
        <div className="error banner">{error ?? "Няма данни"}</div>
      </main>
    );
  }

  const roles = matrix.roles;
  return (
    <Workspace className="ui-permissions-workspace">
      <WorkspaceIntro eyebrow="ПОЛИТИКИ ЗА ДОСТЪП" title="Права" description="Прегледайте достъпа по роли. Запазвайте всяка промяна с ясна причина." />
      {error && <div className="error banner" role="alert">{error}</div>}
      {feedback && <div role="status" className={feedback.kind === "ok" ? "ok banner" : "error banner"}>{feedback.text}
        {feedback.kind === "saved_refresh_failed" && <button type="button" className="linkish" onClick={() => void refresh().catch((err) => setError(err instanceof Error ? err.message : "Reload failed"))}>Презареди матрицата</button>}
      </div>}
      <div className="ui-section-layout">
        <aside>
          <SectionNav<Tab> label="Permission sections" items={[{id: "panels", label: "Панели", description: "Кои работни пространства са достъпни"}, {id: "actions", label: "Actions", description: "Кои действия може да изпълнява ролята"}, {id: "history", label: "Хронология", description: "Кой е променил политиката и защо"}]} value={tab} onChange={setTab} />
          <div className="ui-context-note"><strong>{ROLE_LABELS.owner}</strong><p>Собственикът има всички права. Достъпът му е постоянен и не се редактира.</p></div>
        </aside>
        <div className="ui-section-content">
          {tab !== "history" ? <div className="ui-policy-grid">
            {roles.map((role) => {
              const keys = tab === "panels" ? matrix.panels : matrix.actions;
              const list = tab === "panels" ? draft[role]?.panels ?? [] : draft[role]?.actions ?? [];
              const editable = editableSet.has(role);
              const saving = savingRoles.has(role);
              const conflict = conflictRoles.has(role);
              return <Surface key={role} className="ui-policy-card" title={ROLE_LABELS[role]} description={`${list.length} / ${keys.length} ${tab === "panels" ? "панела" : "действия"}`}>
                {!editable && <p className="muted">Само за преглед</p>}
                {conflict && <div className="error banner" role="status">Има по-нова версия на сървъра.<button type="button" className="linkish" disabled={saving} onClick={() => acceptRemote(role)}>Приеми сървърната</button></div>}
                <fieldset className="ui-grant-list" disabled={!editable || saving}><legend className="sr-only">{ROLE_LABELS[role]} — {tab === "panels" ? "панели" : "действия"}</legend>
                  {keys.map((key) => <label key={key} className="ui-grant-option"><input type="checkbox" checked={list.includes(key)} aria-label={`${role} ${key}`} onChange={() => toggle(role, tab === "panels" ? "panels" : "actions", key)} /><span>{GRANT_LABELS[key] ?? key}</span></label>)}
                </fieldset>
                {editable && <div className="ui-policy-commit"><label>Причина за промяната<input placeholder="причина" value={reasonByRole[role] ?? ""} disabled={saving} onChange={(e) => setReasonByRole((previous) => ({...previous, [role]: e.target.value}))} /></label><button type="button" disabled={saving || conflict} onClick={() => void saveRole(role)}>{saving ? "Запис…" : "Save"}</button></div>}
              </Surface>;
            })}
          </div> : <Surface title="История на достъпа">
            {historyStatus === "loading" && <LoadingIndicator variant="inline" label="Зареждане…" delayMs={0} />}
            {historyStatus === "error" && <p className="error" role="alert">{historyError ?? "Грешка при зареждане на хронологията"}</p>}
            {historyStatus === "empty" && <p className="muted">Няма записи</p>}
            {historyStatus === "success" && <ol className="ui-history-ledger">{history.map((row) => <li key={row.id}>
              <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time><div><strong>{ROLE_LABELS[row.role] ?? row.role}</strong><p>{row.granted ? "Предоставен" : "Отнет"} достъп · {GRANT_LABELS[row.key] ?? row.key}</p><p className="muted">{row.actor.fullName} · {row.reason ?? "Без посочена причина"}</p></div>
            </li>)}</ol>}
          </Surface>}
          <p className="muted small">Достъпът до настройката за права се запазва заедно с разрешението за управление.</p>
        </div>
      </div>
    </Workspace>
  );
}
