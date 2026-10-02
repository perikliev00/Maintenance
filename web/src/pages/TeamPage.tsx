import { useCallback, useEffect, useState } from "react";
import {
  ALL_ROLES,
  ROLE_LABELS,
  fetchPeople,
  type Person,
  type Role,
} from "../api/client";

export function TeamPage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"" | Role>("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const data = await fetchPeople({
      q: q.trim() || undefined,
      role: role || undefined,
      includeInactive,
    });
    setPeople(data);
  }, [q, role, includeInactive]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load people");
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>Team</h1>
          <p>Хора, роли и статус на профилите</p>
        </div>
      </header>

      <div className="toolbar">
        <label>
          Search
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, email, number…"
          />
        </label>
        <label>
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "" | Role)}
          >
            <option value="">All roles</option>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]} ({r})
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Show inactive
        </label>
        <button type="button" className="ghost" onClick={() => refresh()}>
          Refresh
        </button>
      </div>

      {error && <div className="error banner">{error}</div>}

      {loading ? (
        <p className="muted">Loading people…</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Number</th>
                <th>Email</th>
                <th>Role</th>
                <th>Department</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {people.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No profiles match the filters.
                  </td>
                </tr>
              ) : (
                people.map((person) => (
                  <tr key={person.id}>
                    <td>{person.fullName}</td>
                    <td>{person.employeeNumber}</td>
                    <td>{person.email}</td>
                    <td>
                      <span className={`pill role-${person.role}`}>
                        {ROLE_LABELS[person.role] ?? person.role}
                      </span>
                      <div className="muted">{person.role}</div>
                    </td>
                    <td>{person.department ?? "—"}</td>
                    <td>
                      <span
                        className={`pill ${person.isActive ? "ready-ready" : "ready-not_ready"}`}
                      >
                        {person.isActive ? "active" : "inactive"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
