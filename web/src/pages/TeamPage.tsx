import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ALL_ROLES,
  ROLE_LABELS,
  canPerformAction,
  deviceFingerprint,
  fetchInvitations,
  fetchPeople,
  issueInvitation,
  revokeInvitation,
  type AuthUser,
  type Invitation,
  type IssuedInvitation,
  type Person,
  type Role,
} from "../api/client";

type Props = {
  user: AuthUser;
};

type Tab = "directory" | "onboarding";

function qrImageUrl(payload: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(payload)}`;
}

export function TeamPage({ user }: Props) {
  const canInvite = canPerformAction(user, "people.invite");
  const [tab, setTab] = useState<Tab>("directory");

  const [people, setPeople] = useState<Person[]>([]);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"" | Role>("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [notOnboarded, setNotOnboarded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [invites, setInvites] = useState<Invitation[]>([]);
  const [inviteKind, setInviteKind] = useState<"new" | "existing">("new");
  const [fullName, setFullName] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("housekeeper");
  const [department, setDepartment] = useState("");
  const [existingEmployeeId, setExistingEmployeeId] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  const inviteableRoles = useMemo(() => {
    if (user.role === "owner") return ALL_ROLES;
    return ALL_ROLES.filter((r) => r !== "owner" && r !== "admin");
  }, [user.role]);

  const existingCandidates = useMemo(
    () => people.filter((p) => !p.onboarded || p.userId),
    [people],
  );

  const selectedExisting = existingCandidates.find(
    (p) => p.employeeId === existingEmployeeId,
  );

  const refreshDirectory = useCallback(async () => {
    setError(null);
    const data = await fetchPeople({
      q: q.trim() || undefined,
      role: role || undefined,
      includeInactive,
      notOnboarded: notOnboarded || undefined,
    });
    setPeople(data);
  }, [q, role, includeInactive, notOnboarded]);

  const refreshInvites = useCallback(async () => {
    if (!canInvite) return;
    const data = await fetchInvitations();
    setInvites(data);
  }, [canInvite]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await refreshDirectory();
        if (canInvite) await refreshInvites();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load people");
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshDirectory, refreshInvites, canInvite]);

  async function onIssue(e: FormEvent) {
    e.preventDefault();
    if (!canInvite) return;
    setIssuing(true);
    setError(null);
    setInviteMessage(null);
    setIssued(null);
    try {
      let result: IssuedInvitation;
      if (inviteKind === "new") {
        result = await issueInvitation({
          kind: "new",
          fullName: fullName.trim(),
          employeeNumber: employeeNumber.trim(),
          email: email.trim(),
          role: inviteRole,
          department: department.trim() || null,
        });
      } else {
        if (!existingEmployeeId) {
          throw new Error("Select an employee");
        }
        const needsCreds = selectedExisting && !selectedExisting.userId;
        result = await issueInvitation({
          kind: "existing",
          employeeId: existingEmployeeId,
          ...(needsCreds
            ? { email: email.trim(), role: inviteRole }
            : {}),
        });
      }
      setIssued(result);
      setInviteMessage("Invitation issued. Share the code or QR with the device.");
      await Promise.all([refreshDirectory(), refreshInvites()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to issue invitation");
    } finally {
      setIssuing(false);
    }
  }

  async function onRevoke(id: string) {
    try {
      setError(null);
      await revokeInvitation(id);
      if (issued?.invitation.id === id) setIssued(null);
      await refreshInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke");
    }
  }

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>Team</h1>
          <p>Хора, роли, onboarding и устройства</p>
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented" role="tablist">
          <button
            type="button"
            className={tab === "directory" ? "active" : ""}
            onClick={() => setTab("directory")}
          >
            Directory
          </button>
          {canInvite && (
            <button
              type="button"
              className={tab === "onboarding" ? "active" : ""}
              onClick={() => setTab("onboarding")}
            >
              Onboarding
            </button>
          )}
        </div>
      </div>

      {error && <div className="error banner">{error}</div>}
      {inviteMessage && tab === "onboarding" && (
        <div className="ok banner">{inviteMessage}</div>
      )}

      {tab === "directory" && (
        <>
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
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={notOnboarded}
                onChange={(e) => setNotOnboarded(e.target.checked)}
              />
              Only not onboarded
            </label>
            <button type="button" className="ghost" onClick={() => refreshDirectory()}>
              Refresh
            </button>
          </div>

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
                    <th>Devices</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {people.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="muted">
                        No profiles match the filters.
                      </td>
                    </tr>
                  ) : (
                    people.map((person) => (
                      <tr key={person.employeeId}>
                        <td>{person.fullName}</td>
                        <td>{person.employeeNumber}</td>
                        <td>{person.email ?? "—"}</td>
                        <td>
                          {person.role ? (
                            <>
                              <span className={`pill role-${person.role}`}>
                                {ROLE_LABELS[person.role] ?? person.role}
                              </span>
                              <div className="muted">{person.role}</div>
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>{person.department ?? "—"}</td>
                        <td>{person.deviceCount}</td>
                        <td>
                          {!person.isActive ? (
                            <span className="pill ready-not_ready">blocked</span>
                          ) : person.onboarded ? (
                            <span className="pill ready-ready">active</span>
                          ) : (
                            <span className="pill ready-needs_check">
                              not onboarded
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "onboarding" && canInvite && (
        <div className="control-grid">
          <section className="panel">
            <div className="panel-header">
              <h2>Issue invitation</h2>
            </div>
            <form className="stack-form" onSubmit={onIssue}>
              <div className="segmented">
                <button
                  type="button"
                  className={inviteKind === "new" ? "active" : ""}
                  onClick={() => setInviteKind("new")}
                >
                  New person
                </button>
                <button
                  type="button"
                  className={inviteKind === "existing" ? "active" : ""}
                  onClick={() => setInviteKind("existing")}
                >
                  Existing
                </button>
              </div>

              {inviteKind === "new" ? (
                <>
                  <label>
                    Full name
                    <input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Employee number
                    <input
                      value={employeeNumber}
                      onChange={(e) => setEmployeeNumber(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Email
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Department
                    <input
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                    />
                  </label>
                  <label>
                    Role
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as Role)}
                    >
                      {inviteableRoles.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]} ({r})
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Employee
                    <select
                      value={existingEmployeeId}
                      onChange={(e) => setExistingEmployeeId(e.target.value)}
                      required
                    >
                      <option value="">Select…</option>
                      {existingCandidates.map((p) => (
                        <option key={p.employeeId} value={p.employeeId}>
                          {p.fullName} ({p.employeeNumber})
                          {!p.onboarded ? " — not onboarded" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedExisting && !selectedExisting.userId && (
                    <>
                      <label>
                        Email
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                        />
                      </label>
                      <label>
                        Role
                        <select
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value as Role)}
                        >
                          {inviteableRoles.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]} ({r})
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                </>
              )}

              <button type="submit" disabled={issuing}>
                {issuing ? "Issuing…" : "Issue code"}
              </button>
            </form>

            {issued && (
              <div className="invite-result">
                <h3>One-time code</h3>
                <p className="invite-code">{issued.code}</p>
                <p className="muted">
                  Expires {new Date(issued.expiresAt).toLocaleString()}
                </p>
                <img
                  src={qrImageUrl(issued.qrPayload)}
                  alt="Invitation QR code"
                  width={200}
                  height={200}
                />
                <p className="muted small">
                  QR opens activation on this app. Fingerprint seed:{" "}
                  {deviceFingerprint().slice(0, 12)}…
                </p>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    void navigator.clipboard?.writeText(issued.code);
                  }}
                >
                  Copy code
                </button>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Active codes</h2>
              <button type="button" className="ghost" onClick={() => refreshInvites()}>
                Refresh
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Hint</th>
                    <th>Role</th>
                    <th>Expires</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {invites.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        No active invitation codes.
                      </td>
                    </tr>
                  ) : (
                    invites.map((inv) => (
                      <tr key={inv.id}>
                        <td>
                          {inv.fullName}
                          <div className="muted">{inv.email}</div>
                        </td>
                        <td>…{inv.codeHint}</td>
                        <td>{ROLE_LABELS[inv.role] ?? inv.role}</td>
                        <td>{new Date(inv.expiresAt).toLocaleString()}</td>
                        <td>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => onRevoke(inv.id)}
                          >
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
