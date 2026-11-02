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
import {
  applySavedRoleToDraft,
  historyStatusFromResult,
  mergeMatrixIntoDraft,
  type HistoryUiStatus,
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

/**
 * Role permission matrix editor (panels + actions) with change history.
 * Only roles in `editableRoles` can be toggled; saves require a per-role reason.
 */
export function PermissionsPage({ user, onUserUpdated }: Props) {
  const [tab, setTab] = useState<Tab>("panels");
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [draft, setDraft] = useState<Record<string, RoleGrantDraft>>({});
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

  const applyMatrix = useCallback(
    (data: PermissionMatrix, replacedRole?: string) => {
      setMatrix(data);
      setDraft((prev) =>
        mergeMatrixIntoDraft(prev, data.byRole, data.roles, replacedRole),
      );
    },
    [],
  );

  /** Full matrix load; optionally preserve dirty drafts except one replaced role. */
  const refresh = useCallback(
    async (replacedRole?: string) => {
      const data = await fetchPermissionMatrix();
      applyMatrix(data, replacedRole);
      return data;
    },
    [applyMatrix],
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

    const started = beginPermissionsSave(savingRolesRef.current, role);
    if (!started) return;
    savingRolesRef.current = started;
    setSavingRoles(new Set(savingRolesRef.current));
    setError(null);
    setFeedback(null);

    const roleLabel = ROLE_LABELS[role as Role] ?? role;
    try {
      const outcome = await runPermissionsSave(
        {
          role,
          roleLabel,
          draft: body,
          expectedVersion: matrix?.versions?.[role],
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
            await refresh(role);
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
        setDraft((prev) =>
          applySavedRoleToDraft(prev, role, {
            panels: result.panels,
            actions: result.actions,
          }),
        );
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
        <p className="muted">Зареждане на матрицата…</p>
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
    <main className="content">
      <header className="page-header">
        <div>
          <h1>Права</h1>
          <p>Матрица роли × панели / действия (DB-driven)</p>
        </div>
      </header>

      <div className="settings-tabs" role="tablist">
        {(
          [
            ["panels", "Панели"],
            ["actions", "Actions"],
            ["history", "Хронология"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={tab === id ? "nav-tab active" : "nav-tab"}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="error banner">{error}</div>}
      {feedback && (
        <div
          className={
            feedback.kind === "ok" ? "ok banner" : "error banner"
          }
        >
          {feedback.text}
          {feedback.kind === "saved_refresh_failed" && (
            <>
              {" "}
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  void refresh().catch((err) =>
                    setError(
                      err instanceof Error ? err.message : "Reload failed",
                    ),
                  );
                }}
              >
                Презареди матрицата
              </button>
            </>
          )}
        </div>
      )}

      {tab !== "history" && (
        <section className="panel">
          <div className="table-wrap perm-matrix-wrap">
            <table className="perm-matrix">
              <thead>
                <tr>
                  <th>{tab === "panels" ? "Панел" : "Action"}</th>
                  {roles.map((role) => (
                    <th key={role}>
                      {ROLE_LABELS[role]}
                      {!editableSet.has(role) && (
                        <div className="muted">read-only</div>
                      )}
                    </th>
                  ))}
                  <th>
                    {ROLE_LABELS.owner}
                    <div className="muted">всички</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(tab === "panels" ? matrix.panels : matrix.actions).map(
                  (key) => (
                    <tr key={key}>
                      <td>
                        <code>{key}</code>
                      </td>
                      {roles.map((role) => {
                        const list =
                          tab === "panels"
                            ? draft[role]?.panels ?? []
                            : draft[role]?.actions ?? [];
                        const checked = list.includes(key);
                        const canEdit =
                          editableSet.has(role) && !savingRoles.has(role);
                        return (
                          <td key={role} className="perm-cell">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!canEdit}
                              onChange={() =>
                                toggle(
                                  role,
                                  tab === "panels" ? "panels" : "actions",
                                  key,
                                )
                              }
                              aria-label={`${role} ${key}`}
                            />
                          </td>
                        );
                      })}
                      <td className="perm-cell">
                        <input type="checkbox" checked disabled readOnly />
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td>Запис</td>
                  {roles.map((role) => (
                    <td key={role} className="perm-save-cell">
                      {editableSet.has(role) ? (
                        <div className="perm-save-col">
                          <input
                            placeholder="причина"
                            value={reasonByRole[role] ?? ""}
                            disabled={savingRoles.has(role)}
                            onChange={(e) =>
                              setReasonByRole((r) => ({
                                ...r,
                                [role]: e.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            disabled={savingRoles.has(role)}
                            onClick={() => saveRole(role)}
                          >
                            {savingRoles.has(role) ? "…" : "Save"}
                          </button>
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  ))}
                  <td className="muted">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted">
            Owner винаги има всички права. Панелът <code>permissions</code> е
            вързан с <code>permissions.manage</code>.
          </p>
        </section>
      )}

      {tab === "history" && (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Време</th>
                  <th>Роля</th>
                  <th>Вид</th>
                  <th>Ключ</th>
                  <th>Промяна</th>
                  <th>Актор</th>
                  <th>Причина</th>
                </tr>
              </thead>
              <tbody>
                {historyStatus === "loading" && (
                  <tr>
                    <td colSpan={7} className="muted">
                      Зареждане…
                    </td>
                  </tr>
                )}
                {historyStatus === "error" && (
                  <tr>
                    <td colSpan={7} className="error">
                      {historyError ?? "Грешка при зареждане на хронологията"}
                    </td>
                  </tr>
                )}
                {historyStatus === "empty" && (
                  <tr>
                    <td colSpan={7} className="muted">
                      Няма записи
                    </td>
                  </tr>
                )}
                {historyStatus === "success" &&
                  history.map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.createdAt).toLocaleString()}</td>
                      <td>{ROLE_LABELS[row.role] ?? row.role}</td>
                      <td>{row.kind}</td>
                      <td>
                        <code>{row.key}</code>
                      </td>
                      <td>{row.granted ? "granted" : "revoked"}</td>
                      <td>{row.actor.fullName}</td>
                      <td>{row.reason ?? "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
