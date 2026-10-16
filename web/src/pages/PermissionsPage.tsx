/**
 * Role permission matrix editor (panels + actions) with change history.
 * Only roles in `editableRoles` can be toggled; saves require a per-role reason.
 * After save, refreshes `fetchMe` so the caller's nav/grants update immediately.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
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
  // Active editor tab: panels matrix, actions matrix, or audit history.
  const [tab, setTab] = useState<Tab>("panels");
  // Server matrix (roles, keys, editableRoles); null until first load.
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  // Editable clone of grants keyed by role.
  const [draft, setDraft] = useState<
    Record<string, { panels: string[]; actions: string[] }>
  >({});
  // Optional change-reason string collected per role before save.
  const [reasonByRole, setReasonByRole] = useState<Record<string, string>>({});
  // History rows loaded when the history tab is selected.
  const [history, setHistory] = useState<PermissionHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Role id currently mid-save (disables that column's Save button).
  const [savingRole, setSavingRole] = useState<string | null>(null);

  /**
   * Fetch matrix and clone grants into the editable draft.
   */
  const refresh = useCallback(async () => {
    const data = await fetchPermissionMatrix();
    // State transition.
    setMatrix(data);
    // Deep-clone panel/action arrays so toggles do not mutate the response.
    const next: Record<string, { panels: string[]; actions: string[] }> = {};
    // Loop over collection.
    for (const role of data.roles) {
      next[role] = {
        panels: [...(data.byRole[role]?.panels ?? [])],
        actions: [...(data.byRole[role]?.actions ?? [])],
      };
    }
    // State transition.
    setDraft(next);
  }, []);

  // Initial matrix load on mount.
  useEffect(() => {
    (async () => {
      // Try block for fallible work.
      try {
        // State transition.
        setLoading(true);
        // State transition.
        setError(null);
        // Await async step.
        await refresh();
      } catch (err) {
        // State transition.
        setError(err instanceof Error ? err.message : "Failed to load matrix");
      } finally {
        // State transition.
        setLoading(false);
      }
    })();
  }, [refresh]);

  // History tab loads its own list on demand (not with the matrix).
  useEffect(() => {
    // Skip fetch while on panels/actions tabs.
    if (tab !== "history") return;
    fetchPermissionHistory({ limit: 100 })
      // Promise then handler.
      .then(setHistory)
      // Promise catch handler.
      .catch((err) =>
        // State transition.
        setError(err instanceof Error ? err.message : "History failed"),
      );
  }, [tab]);

  // Roles the current user is allowed to edit (from the matrix response).
  const editableSet = useMemo(
    () => new Set(matrix?.editableRoles ?? []),
    [matrix],
  );

  /**
   * Toggle a panel or action grant in the draft for a role.
   * Keeps `permissions` panel and `permissions.manage` action in sync.
   */
  function toggle(role: string, kind: "panels" | "actions", key: string) {
    // Permission gate: non-editable roles are read-only in the UI.
    if (!editableSet.has(role as Exclude<Role, "owner">)) return;
    // State transition.
    setDraft((prev) => {
      const cur = prev[role] ?? { panels: [], actions: [] };
      const list = new Set(cur[kind]);
      // Flip membership of the toggled key.
      if (list.has(key)) list.delete(key);
      else list.add(key);

      // Keep permissions panel synced with permissions.manage action.
      if (kind === "actions" && key === "permissions.manage") {
        const panels = new Set(cur.panels);
        // Branch: conditional gate.
        if (list.has("permissions.manage")) panels.add("permissions");
        else panels.delete("permissions");
        // Early / value return.
        return {
          ...prev,
          [role]: { panels: [...panels], actions: [...list] },
        };
      }
      // Inverse sync: toggling the permissions panel updates the manage action.
      if (kind === "panels" && key === "permissions") {
        const actions = new Set(cur.actions);
        // Branch: conditional gate.
        if (list.has("permissions")) actions.add("permissions.manage");
        else actions.delete("permissions.manage");
        // Early / value return.
        return {
          ...prev,
          [role]: { panels: [...list], actions: [...actions] },
        };
      }

      // Default: only the toggled kind list changes.
      return {
        ...prev,
        [role]: { ...cur, [kind]: [...list] },
      };
    });
  }

  /**
   * Persist one role's draft grants, then refresh matrix and optionally caller session.
   */
  async function saveRole(role: string) {
    const body = draft[role];
    // Nothing to save if draft missing for this role.
    if (!body) return;
    // State transition.
    setSavingRole(role);
    // State transition.
    setError(null);
    // State transition.
    setMessage(null);
    // Try block for fallible work.
    try {
      // Optional trim; empty reason becomes undefined (server may not require it).
      await putRoleGrants(
        role as Role,
        body.panels,
        body.actions,
        reasonByRole[role]?.trim() || undefined,
      );
      // State transition.
      setMessage(`Запазени права за ${ROLE_LABELS[role as Role] ?? role}`);
      // Clear the reason field after a successful save.
      setReasonByRole((r) => ({ ...r, [role]: "" }));
      // Await async step.
      await refresh();
      // If the caller's own role (or owner) changed, refresh session grants/nav.
      if (user.role === role || user.role === "owner") {
        const me = await fetchMe();
        onUserUpdated?.(me);
      }
      // Keep history table fresh when that tab is visible.
      if (tab === "history") {
        // State transition.
        setHistory(await fetchPermissionHistory({ limit: 100 }));
      }
    } catch (err) {
      // State transition.
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      // State transition.
      setSavingRole(null);
    }
  }

  // First-load gate: no matrix yet.
  if (loading && !matrix) {
    // Early / value return.
    return (
      <main className="content">
        <p className="muted">Зареждане на матрицата…</p>
      </main>
    );
  }

  // Hard failure: load finished without matrix data.
  if (!matrix) {
    // Early / value return.
    return (
      <main className="content">
        <div className="error banner">{error ?? "Няма данни"}</div>
      </main>
    );
  }

  const roles = matrix.roles;

  // Early / value return.
  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>Права</h1>
          <p>Матрица роли × панели / действия (DB-driven)</p>
        </div>
      </header>

      {/* Tab strip: panels / actions / history. */}
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

      {/* Error / success banners above the matrix. */}
      {error && <div className="error banner">{error}</div>}
      {/* Render branch: message && <div className="ok banner">message</div> */}
      {message && <div className="ok banner">{message}</div>}

      {/* Editable matrix for panels or actions (not history). */}
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
                      {/* Mark columns the caller cannot edit. */}
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
                        // Resolve checked state from the draft for this tab kind.
                        const list =
                          tab === "panels"
                            ? draft[role]?.panels ?? []
                            : draft[role]?.actions ?? [];
                        const checked = list.includes(key);
                        // Permission / capability gate.
                        const canEdit = editableSet.has(role);
                        // Early / value return.
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
                      // Owner column is always granted and non-editable.
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
                      // Save UI only for roles in editableRoles.
                      {editableSet.has(role) ? (
                        <div className="perm-save-col">
                          <input
                            placeholder="причина"
                            value={reasonByRole[role] ?? ""}
                            onChange={(e) =>
                              // State transition.
                              setReasonByRole((r) => ({
                                ...r,
                                [role]: e.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            disabled={savingRole === role}
                            onClick={() => saveRole(role)}
                          >
                            {savingRole === role ? "…" : "Save"}
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

      // Audit history table (loaded when this tab is active).
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
                // Empty vs populated history rows.
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      Няма записи
                    </td>
                  </tr>
                ) : (
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
