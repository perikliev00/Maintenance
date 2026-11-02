import { ROLE_LABELS, type Role } from "../../api/client";
import type { ControlBoard } from "./useControlBoard";

type Props = Pick<
  ControlBoard,
  | "user"
  | "allowedRoles"
  | "people"
  | "roleDrafts"
  | "setRoleDrafts"
  | "searchInput"
  | "searchPending"
  | "peopleLoading"
  | "peopleError"
  | "onSearchInputChange"
  | "saveRole"
  | "savingIds"
>;

export function ControlRolesSection({
  user,
  allowedRoles,
  people,
  roleDrafts,
  setRoleDrafts,
  searchInput,
  searchPending,
  peopleLoading,
  peopleError,
  onSearchInputChange,
  saveRole,
  savingIds,
}: Props) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Роли</h2>
        <label className="inline-search">
          Search
          <input
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            placeholder="Name, email…"
          />
        </label>
        {(searchPending || peopleLoading) && (
          <span className="muted">Searching…</span>
        )}
      </div>
      {peopleError && <p className="error">{peopleError}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Number</th>
              <th>Email</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {people
              .filter((p) => p.userId && p.role)
              .map((person) => {
                const draft =
                  roleDrafts[person.userId!] ?? (person.role as Role);
                const options =
                  user.role === "owner"
                    ? allowedRoles
                    : Array.from(
                        new Set([...allowedRoles, person.role as Role]),
                      ).filter(
                        (r) =>
                          allowedRoles.includes(r) || r === person.role,
                      );
                const locked =
                  user.role === "manager" &&
                  (person.role === "owner" || person.role === "admin");
                const saving = savingIds.has(person.userId!);

                return (
                  <tr key={person.userId}>
                    <td>{person.fullName}</td>
                    <td>{person.employeeNumber}</td>
                    <td>{person.email}</td>
                    <td>
                      <select
                        value={draft}
                        disabled={locked || saving}
                        onChange={(e) =>
                          setRoleDrafts((prev) => ({
                            ...prev,
                            [person.userId!]: e.target.value as Role,
                          }))
                        }
                      >
                        {options.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]} ({r})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        disabled={locked || saving || draft === person.role}
                        onClick={() => void saveRole(person)}
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
