import type { FormEvent } from "react";
import {
  ROLE_LABELS,
  deviceFingerprint,
  type Invitation,
  type IssuedInvitation,
  type Person,
  type Role,
} from "../../api/client";
import { LoadingIndicator } from "../../components/LoadingIndicator";
import { t } from "./labels";
import type { PeopleListViewState } from "./peopleListSession";

export type TeamOnboardingPanelProps = {
  locale: "bg" | "en";
  inviteKind: "new" | "existing";
  onInviteKindChange: (kind: "new" | "existing") => void;
  fullName: string;
  onFullNameChange: (value: string) => void;
  employeeNumber: string;
  onEmployeeNumberChange: (value: string) => void;
  email: string;
  onEmailChange: (value: string) => void;
  inviteRole: Role;
  onInviteRoleChange: (role: Role) => void;
  department: string;
  onDepartmentChange: (value: string) => void;
  candidateQ: string;
  onCandidateSearchInput: (value: string) => void;
  existingEmployeeId: string;
  onExistingEmployeeIdChange: (value: string) => void;
  candidatesState: PeopleListViewState;
  candidatesSearchPending: boolean;
  candidatesLoadMoreBlocked: boolean;
  existingCandidates: Person[];
  selectedExisting: Person | undefined;
  inviteableRoles: Role[];
  issuing: boolean;
  issueExistingDisabled: boolean;
  issued: IssuedInvitation | null;
  invites: Invitation[];
  onIssue: (e: FormEvent) => void;
  onRevoke: (id: string) => void;
  onRefreshInvitesClick: () => void;
  onLoadMoreCandidates: () => void;
};

export function TeamOnboardingPanel({
  locale,
  inviteKind,
  onInviteKindChange,
  fullName,
  onFullNameChange,
  employeeNumber,
  onEmployeeNumberChange,
  email,
  onEmailChange,
  inviteRole,
  onInviteRoleChange,
  department,
  onDepartmentChange,
  candidateQ,
  onCandidateSearchInput,
  existingEmployeeId,
  onExistingEmployeeIdChange,
  candidatesState,
  candidatesSearchPending,
  candidatesLoadMoreBlocked,
  existingCandidates,
  selectedExisting,
  inviteableRoles,
  issuing,
  issueExistingDisabled,
  issued,
  invites,
  onIssue,
  onRevoke,
  onRefreshInvitesClick,
  onLoadMoreCandidates,
}: TeamOnboardingPanelProps) {
  return (
    <div className="ui-onboarding-layout">
      <section className="panel ui-focused-form">
        <div className="panel-header">
          <h2>{t(locale, "Издаване на покана", "Issue invitation")}</h2>
        </div>
        <form className="stack" onSubmit={onIssue}>
          <div className="segmented" role="tablist">
            <button
              type="button"
              className={inviteKind === "new" ? "active" : ""}
              onClick={() => onInviteKindChange("new")}
            >
              {t(locale, "Нов", "New")}
            </button>
            <button
              type="button"
              className={inviteKind === "existing" ? "active" : ""}
              onClick={() => onInviteKindChange("existing")}
            >
              {t(locale, "Съществуващ", "Existing")}
            </button>
          </div>

          {inviteKind === "new" ? (
            <>
              <label>
                {t(locale, "Име", "Full name")}
                <input
                  value={fullName}
                  onChange={(e) => onFullNameChange(e.target.value)}
                  required
                />
              </label>
              <label>
                {t(locale, "Служебен номер", "Employee number")}
                <input
                  value={employeeNumber}
                  onChange={(e) => onEmployeeNumberChange(e.target.value)}
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => onEmailChange(e.target.value)}
                  required
                />
              </label>
              <label>
                {t(locale, "Роля", "Role")}
                <select
                  value={inviteRole}
                  onChange={(e) => onInviteRoleChange(e.target.value as Role)}
                >
                  {inviteableRoles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]} ({r})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t(locale, "Отдел", "Department")}
                <input
                  value={department}
                  onChange={(e) => onDepartmentChange(e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                {t(locale, "Търсене на служител", "Search employee")}
                <input
                  value={candidateQ}
                  onChange={(e) => onCandidateSearchInput(e.target.value)}
                  placeholder={t(
                    locale,
                    "Име, имейл, номер…",
                    "Name, email, number…",
                  )}
                />
              </label>
              <label>
                {t(locale, "Служител", "Employee")}
                <select
                  value={existingEmployeeId}
                  onChange={(e) => onExistingEmployeeIdChange(e.target.value)}
                  required
                  disabled={
                    candidatesSearchPending ||
                    (candidatesState.loading &&
                      candidatesState.people.length === 0)
                  }
                >
                  <option value="">
                    {candidatesState.loading || candidatesSearchPending
                      ? t(locale, "Зареждане…", "Loading…")
                      : t(locale, "Изберете…", "Select…")}
                  </option>
                  {existingCandidates.map((p) => (
                    <option key={p.employeeId} value={p.employeeId}>
                      {p.fullName} ({p.employeeNumber})
                      {p.role ? ` — ${ROLE_LABELS[p.role] ?? p.role}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {candidatesState.nextCursor && (
                <button
                  type="button"
                  className="ghost"
                  disabled={candidatesLoadMoreBlocked}
                  onClick={() => void onLoadMoreCandidates()}
                >
                  {candidatesState.loadingMore ? (
                    <LoadingIndicator
                      variant="inline"
                      delayMs={0}
                      label={t(locale, "Зареждане…", "Loading…")}
                    />
                  ) : (
                    t(locale, "Още кандидати", "Load more candidates")
                  )}
                </button>
              )}
              {selectedExisting && !selectedExisting.userId && (
                <>
                  <label>
                    Email
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => onEmailChange(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    {t(locale, "Роля", "Role")}
                    <select
                      value={inviteRole}
                      onChange={(e) =>
                        onInviteRoleChange(e.target.value as Role)
                      }
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

          <button
            type="submit"
            disabled={
              inviteKind === "existing" ? issueExistingDisabled : issuing
            }
          >
            {issuing
              ? t(locale, "Издаване…", "Issuing…")
              : t(locale, "Издай код", "Issue code")}
          </button>
        </form>

        {issued && (
          <div className="invite-result">
            <h3>{t(locale, "Еднократен код", "One-time code")}</h3>
            <p className="invite-code">{issued.code}</p>
            <p className="muted">
              {t(locale, "Изтича", "Expires")}{" "}
              {new Date(issued.expiresAt).toLocaleString()}
            </p>
            <p className="muted small">
              {t(
                locale,
                "Отворете Activate device от екрана за вход и въведете кода ръчно. Fingerprint:",
                "Open Activate device from the login screen and enter the code manually. Fingerprint:",
              )}{" "}
              {deviceFingerprint().slice(0, 12)}…
            </p>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(issued.code);
              }}
            >
              {t(locale, "Копирай кода", "Copy code")}
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{t(locale, "Активни кодове", "Active codes")}</h2>
          <button
            type="button"
            className="ghost"
            onClick={() => void onRefreshInvitesClick()}
          >
            {t(locale, "Опресни", "Refresh")}
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t(locale, "Човек", "Person")}</th>
                <th>{t(locale, "Подсказка", "Hint")}</th>
                <th>{t(locale, "Роля", "Role")}</th>
                <th>{t(locale, "Изтича", "Expires")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invites.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    {t(
                      locale,
                      "Няма активни кодове за покана.",
                      "No active invitation codes.",
                    )}
                  </td>
                </tr>
              ) : (
                invites.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      {inv.fullName}
                      <div className="muted">{inv.employeeNumber}</div>
                    </td>
                    <td>
                      <code>…{inv.codeHint}</code>
                    </td>
                    <td>{ROLE_LABELS[inv.role] ?? inv.role}</td>
                    <td>{new Date(inv.expiresAt).toLocaleString()}</td>
                    <td>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void onRevoke(inv.id)}
                      >
                        {t(locale, "Отмени", "Revoke")}
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
  );
}
