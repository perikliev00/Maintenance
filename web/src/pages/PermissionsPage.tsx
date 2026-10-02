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

export function PermissionsPage({ user, onUserUpdated }: Props) {
  const [tab, setTab] = useState<Tab>("panels");
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [draft, setDraft] = useState<
    Record<string, { panels: string[]; actions: string[] }>
  >({});
  const [reasonByRole, setReasonByRole] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<PermissionHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await fetchPermissionMatrix();
    setMatrix(data);
    const next: Record<string, { panels: string[]; actions: string[] }> = {};
    for (const role of data.roles) {
      next[role] = {
        panels: [...(data.byRole[role]?.panels ?? [])],
        actions: [...(data.byRole[role]?.actions ?? [])],
      };
    }
    setDraft(next);
  }, []);

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
    fetchPermissionHistory({ limit: 100 })
      .then(setHistory)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "History failed"),
      );
  }, [tab]);

  const editableSet = useMemo(
    () => new Set(matrix?.editableRoles ?? []),
    [matrix],
  );

  function toggle(role: string, kind: "panels" | "actions", key: string) {
    if (!editableSet.has(role as Exclude<Role, "owner">)) return;
    setDraft((prev) => {
      const cur = prev[role] ?? { panels: [], actions: [] };
      const list = new Set(cur[kind]);
      if (list.has(key)) list.delete(key);
      else list.add(key);

      // Keep permissions panel synced with permissions.manage
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

  async function saveRole(role: string) {
    const body = draft[role];
    if (!body) return;
    setSavingRole(role);
    setError(null);
    setMessage(null);
    try {
      await putRoleGrants(
        role as Role,
        body.panels,
        body.actions,
        reasonByRole[role]?.trim() || undefined,
      );
      setMessage(`Запазени права за ${ROLE_LABELS[role as Role] ?? role}`);
      setReasonByRole((r) => ({ ...r, [role]: "" }));
      await refresh();
      if (user.role === role || user.role === "owner") {
        const me = await fetchMe();
        onUserUpdated?.(me);
      }
      if (tab === "history") {
        setHistory(await fetchPermissionHistory({ limit: 100 }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingRole(null);
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
      {message && <div className="ok banner">{message}</div>}

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
                        const canEdit = editableSet.has(role);
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
                            onChange={(e) =>
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
