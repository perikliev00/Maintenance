/**
 * People directory + onboarding invitations. Invite/revoke UI requires
 * `people.invite`; non-owners cannot invite owner/admin roles.
 */
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_ROLES,
  ROLE_LABELS,
  // Permission / capability gate.
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

/** External QR image URL for an invitation payload string. */
function qrImageUrl(payload: string) {
  // Early / value return.
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(payload)}`;
}

/**
 * People directory + onboarding invitations UI.
 * Invite/revoke requires `people.invite`; non-owners cannot invite owner/admin.
 */
export function TeamPage({ user }: Props) {
  const issueInFlight = useRef(false);
  // Gate for onboarding tab and issue/revoke actions.
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

  // Owners may invite any role; others cannot raise to owner/admin.
  const inviteableRoles = useMemo(() => {
    // Branch: conditional gate.
    if (user.role === "owner") return ALL_ROLES;
    // Early / value return.
    return ALL_ROLES.filter((r) => r !== "owner" && r !== "admin");
  }, [user.role]);

  // Candidates for "existing" invites: not onboarded yet, or already have a user.
  const existingCandidates = useMemo(
    () => people.filter((p) => !p.onboarded || p.userId),
    [people],
  );

  // Derive local value.
  const selectedExisting = existingCandidates.find(
    (p) => p.employeeId === existingEmployeeId,
  );

  /** Fetch people list with current directory filters. */
  const refreshDirectory = useCallback(async () => {
    // State transition.
    setError(null);
    // Derive local value.
    const data = await fetchPeople({
      q: q.trim() || undefined,
      role: role || undefined,
      includeInactive,
      notOnboarded: notOnboarded || undefined,
    });
    // State transition.
    setPeople(data);
  }, [q, role, includeInactive, notOnboarded]);

  /** Fetch active invitation codes when the user can invite. */
  const refreshInvites = useCallback(async () => {
    // Branch: conditional gate.
    if (!canInvite) return;
    // Derive local value.
    const data = await fetchInvitations();
    // State transition.
    setInvites(data);
  }, [canInvite]);

  // Load directory (and invites if permitted) whenever filters/permissions change.
  useEffect(() => {
    (async () => {
      // Try block for fallible work.
      try {
        // State transition.
        setLoading(true);
        // Await async step.
        await refreshDirectory();
        // Branch: conditional gate.
        if (canInvite) await refreshInvites();
      } catch (err) {
        // State transition.
        setError(err instanceof Error ? err.message : "Failed to load people");
      } finally {
        // State transition.
        setLoading(false);
      }
    })();
  }, [refreshDirectory, refreshInvites, canInvite]);

  /** Issue a new or existing-person invitation from the onboarding form. */
  async function onIssue(e: FormEvent) {
    e.preventDefault();
    // Branch: conditional gate.
    if (!canInvite || issueInFlight.current) return;
    issueInFlight.current = true;
    // State transition.
    setIssuing(true);
    // State transition.
    setError(null);
    // State transition.
    setInviteMessage(null);
    // State transition.
    setIssued(null);
    // Try block for fallible work.
    try {
      let result: IssuedInvitation;
      // Branch: conditional gate.
      if (inviteKind === "new") {
        // Create employee + invitation in one API call.
        result = await issueInvitation({
          kind: "new",
          fullName: fullName.trim(),
          employeeNumber: employeeNumber.trim(),
          email: email.trim(),
          role: inviteRole,
          department: department.trim() || null,
        });
      } else {
        // Branch: conditional gate.
        if (!existingEmployeeId) {
          // Throw error path.
          throw new Error("Select an employee");
        }
        // Employees without a user account still need email + role for credentials.
        const needsCreds = selectedExisting && !selectedExisting.userId;
        result = await issueInvitation({
          kind: "existing",
          employeeId: existingEmployeeId,
          ...(needsCreds
            ? { email: email.trim(), role: inviteRole }
            : {}),
        });
      }
      // State transition.
      setIssued(result);
      // State transition.
      setInviteMessage("Invitation issued. Share the code or QR with the device.");
      // Refresh both lists so directory status and codes stay in sync.
      await Promise.all([refreshDirectory(), refreshInvites()]);
    } catch (err) {
      // State transition.
      setError(err instanceof Error ? err.message : "Failed to issue invitation");
    } finally {
      // State transition.
      setIssuing(false);
      issueInFlight.current = false;
    }
  }

  /** Revoke an invitation code and clear the issued panel if it matched. */
  async function onRevoke(id: string) {
    // Try block for fallible work.
    try {
      // State transition.
      setError(null);
      // Await async step.
      await revokeInvitation(id);
      // Hide one-time code panel if we just revoked that invitation.
      if (issued?.invitation.id === id) setIssued(null);
      // Await async step.
      await refreshInvites();
    } catch (err) {
      // State transition.
      setError(err instanceof Error ? err.message : "Failed to revoke");
    }
  }

  // Early / value return.
  return (
    <main className="content">
      {/* Panel header. */}
      <header className="page-header">
        <div>
          {/* Section heading. */}
          <h1>Team</h1>
          <p>Хора, роли, onboarding и устройства</p>
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented" role="tablist">
          {/* Action control. */}
          <button
            type="button"
            className={tab === "directory" ? "active" : ""}
            onClick={() => setTab("directory")}
          >
            Directory
          </button>
          {/* Onboarding tab only when invite permission is present. */}
          {/* Action control. */}
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

      {/* Render branch: error && <div className="error banner">error</div> */}
      {error && <div className="error banner">{error}</div>}
      {/* Render branch: inviteMessage && tab === "onboarding" && ( */}
      {inviteMessage && tab === "onboarding" && (
        <div className="ok banner">{inviteMessage}</div>
      )}

      {/* Conditional render branch. */}
      {tab === "directory" && (
        <>
          <div className="toolbar">
            {/* Form field. */}
            <label>
              Search
              {/* Text/checkbox input. */}
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name, email, number…"
              />
            </label>
            {/* Form field. */}
            <label>
              Role
              {/* Select input. */}
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
            {/* Form field. */}
            <label className="checkbox-inline">
              {/* Text/checkbox input. */}
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              Show inactive
            </label>
            {/* Form field. */}
            <label className="checkbox-inline">
              {/* Text/checkbox input. */}
              <input
                type="checkbox"
                checked={notOnboarded}
                onChange={(e) => setNotOnboarded(e.target.checked)}
              />
              Only not onboarded
            </label>
            {/* Action control. */}
            <button type="button" className="ghost" onClick={() => refreshDirectory()}>
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="muted">Loading people…</p>
          ) : (
            <div className="table-wrap">
              {/* Data table. */}
              <table>
                {/* Table header. */}
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
                {/* Table body rows. */}
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
                          {/* Status priority: blocked > active > not onboarded. */}
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

      {/* Onboarding: issue form + active codes list (permission-gated). */}
      {tab === "onboarding" && canInvite && (
        <div className="control-grid">
          {/* Panel section. */}
          <section className="panel">
            <div className="panel-header">
              {/* Section heading. */}
              <h2>Issue invitation</h2>
            </div>
            {/* Editable form. */}
            <form className="stack-form" onSubmit={onIssue}>
              <div className="segmented">
                {/* Action control. */}
                <button
                  type="button"
                  className={inviteKind === "new" ? "active" : ""}
                  onClick={() => setInviteKind("new")}
                >
                  New person
                </button>
                {/* Action control. */}
                <button
                  type="button"
                  className={inviteKind === "existing" ? "active" : ""}
                  onClick={() => setInviteKind("existing")}
                >
                  Existing
                </button>
              </div>

              {/* New-person fields vs existing-employee picker. */}
              {inviteKind === "new" ? (
                <>
                  {/* Form field. */}
                  <label>
                    Full name
                    {/* Text/checkbox input. */}
                    <input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                  </label>
                  {/* Form field. */}
                  <label>
                    Employee number
                    {/* Text/checkbox input. */}
                    <input
                      value={employeeNumber}
                      onChange={(e) => setEmployeeNumber(e.target.value)}
                      required
                    />
                  </label>
                  {/* Form field. */}
                  <label>
                    Email
                    {/* Text/checkbox input. */}
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </label>
                  {/* Form field. */}
                  <label>
                    Department
                    {/* Text/checkbox input. */}
                    <input
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                    />
                  </label>
                  {/* Form field. */}
                  <label>
                    Role
                    {/* Select input. */}
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
                  {/* Form field. */}
                  <label>
                    Employee
                    {/* Select input. */}
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
                  {/* Creds fields only when the employee has no user account yet. */}
                  {selectedExisting && !selectedExisting.userId && (
                    <>
                      {/* Form field. */}
                      <label>
                        Email
                        {/* Text/checkbox input. */}
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                        />
                      </label>
                      {/* Form field. */}
                      <label>
                        Role
                        {/* Select input. */}
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

              {/* Action control. */}
              <button type="submit" disabled={issuing}>
                {/* Render branch: issuing ? "Issuing…" : "Issue code" */}
                {issuing ? "Issuing…" : "Issue code"}
              </button>
            </form>

            {/* One-time code + QR after a successful issue. */}
            {issued && (
              <div className="invite-result">
                {/* Section heading. */}
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
                {/* Action control. */}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    // Fire-and-forget async call.
                    void navigator.clipboard?.writeText(issued.code);
                  }}
                >
                  Copy code
                </button>
              </div>
            )}
          </section>

          {/* Panel section. */}
          <section className="panel">
            <div className="panel-header">
              {/* Section heading. */}
              <h2>Active codes</h2>
              {/* Action control. */}
              <button type="button" className="ghost" onClick={() => refreshInvites()}>
                Refresh
              </button>
            </div>
            <div className="table-wrap">
              {/* Data table. */}
              <table>
                {/* Table header. */}
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Hint</th>
                    <th>Role</th>
                    <th>Expires</th>
                    <th></th>
                  </tr>
                </thead>
                {/* Table body rows. */}
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
                          {/* Action control. */}
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
