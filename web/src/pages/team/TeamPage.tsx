/**
 * People directory + onboarding invitations. Invite/revoke UI requires
 * `people.invite`; non-owners cannot invite owner/admin roles.
 */
import { useCallback, useRef, useState } from "react";
import {
  canManagePersonAccess,
  canPerformAction,
  logout,
  type AuthUser,
  type Person,
} from "../../api/client";
import { t } from "./labels";
import { runLifecycleAction } from "./runLifecycleAction";
import { TeamDirectoryPanel } from "./TeamDirectoryPanel";
import { TeamOnboardingPanel } from "./TeamOnboardingPanel";
import { TeamPersonDetailDialog } from "./TeamPersonDetailDialog";
import { TeamPersonDevicesDialog } from "./TeamPersonDevicesDialog";
import { useTeamDirectory } from "./useTeamDirectory";
import { useTeamOnboarding } from "./useTeamOnboarding";

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
};

type Tab = "directory" | "onboarding";

// Export function TeamPage as part of this module's API.
export function TeamPage({ user, locale = "bg" }: Props) {
  const canInvite = canPerformAction(user, "people.invite");
  const canManageAccess = canPerformAction(user, "people.manage_access");
  const [tab, setTab] = useState<Tab>("directory");
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [lifecycleBusyId, setLifecycleBusyId] = useState<string | null>(null);
  const [devicesPerson, setDevicesPerson] = useState<Person | null>(null);
  const [detailPerson, setDetailPerson] = useState<Person | null>(null);

  const refreshInvitesRef = useRef<(() => Promise<void>) | undefined>(
    undefined,
  );

  const onFiltersReloadSideEffects = useCallback(async () => {
    if (!canInvite) return;
    try {
      await refreshInvitesRef.current?.();
    } catch {
      // refreshInvites sets banner
    }
  }, [canInvite]);

  // Invoke useTeamDirectory hook for page/feature state and behavior.
  const directory = useTeamDirectory({
    locale,
    setBannerError,
    onFiltersReloadSideEffects,
  });

  // Invoke useTeamOnboarding hook for page/feature state and behavior.
  const onboarding = useTeamOnboarding({
    user,
    locale,
    canInvite,
    tab,
    setBannerError,
    reloadDirectory: directory.reloadDirectory,
  });

  refreshInvitesRef.current = onboarding.refreshInvites;

  const displayError =
    bannerError ||
    (tab === "directory" ? directory.loadError : null) ||
    (tab === "onboarding" && onboarding.inviteKind === "existing"
      ? onboarding.candidatesLoadError
      : null);

  const handleLifecycleAction = useCallback(
    (person: Person, action: Parameters<typeof runLifecycleAction>[1]) => {
      // Fire-and-forget async work without awaiting in this path.
      void runLifecycleAction(person, action, {
        locale,
        lifecycleBusyId,
        setLifecycleBusyId,
        setBannerError,
        setDetailPerson,
        getCommittedDirectoryQuery: directory.getCommittedDirectoryQuery,
        reloadDirectoryWithQuery: directory.reloadDirectoryWithQuery,
      });
    },
    [
      locale,
      lifecycleBusyId,
      directory.getCommittedDirectoryQuery,
      directory.reloadDirectoryWithQuery,
    ],
  );

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>{t(locale, "Екип", "Team")}</h1>
          <p>
            {t(
              locale,
              "Хора, роли, onboarding и устройства",
              "People, roles, onboarding and devices",
            )}
          </p>
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented" role="tablist">
          <button
            type="button"
            className={tab === "directory" ? "active" : ""}
            onClick={() => setTab("directory")}
          >
            {t(locale, "Списък", "Directory")}
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

            {displayError && <div className="error banner">{displayError}</div>}
            {onboarding.inviteMessage && tab === "onboarding" && (
        <div className="ok banner">{onboarding.inviteMessage}</div>
      )}

            {tab === "directory" && (
        <TeamDirectoryPanel
          locale={locale}
          user={user}
          canManageAccess={canManageAccess}
          q={directory.q}
          role={directory.role}
          includeInactive={directory.includeInactive}
          includeArchived={directory.includeArchived}
          notOnboarded={directory.notOnboarded}
          onDirectorySearchInput={directory.onDirectorySearchInput}
          onRoleChange={directory.setRole}
          onIncludeInactiveChange={directory.setIncludeInactive}
          onIncludeArchivedChange={directory.setIncludeArchived}
          onNotOnboardedChange={directory.setNotOnboarded}
          onRefreshDirectoryClick={() => void directory.onRefreshDirectoryClick()}
          directoryLoading={directory.directoryState.loading}
          loading={directory.loading}
          refreshing={directory.refreshing}
          loadingMore={directory.loadingMore}
          loadMoreBlocked={directory.loadMoreBlocked}
          people={directory.people}
          peopleCursor={directory.peopleCursor}
          lifecycleBusyId={lifecycleBusyId}
          onViewPerson={setDetailPerson}
          onDevicesPerson={setDevicesPerson}
          onLifecycleAction={handleLifecycleAction}
          onLoadMoreDirectory={() => void directory.onLoadMoreDirectory()}
        />
      )}

            {tab === "onboarding" && canInvite && (
        <TeamOnboardingPanel
          locale={locale}
          inviteKind={onboarding.inviteKind}
          onInviteKindChange={onboarding.setInviteKind}
          fullName={onboarding.fullName}
          onFullNameChange={onboarding.setFullName}
          employeeNumber={onboarding.employeeNumber}
          onEmployeeNumberChange={onboarding.setEmployeeNumber}
          email={onboarding.email}
          onEmailChange={onboarding.setEmail}
          inviteRole={onboarding.inviteRole}
          onInviteRoleChange={onboarding.setInviteRole}
          department={onboarding.department}
          onDepartmentChange={onboarding.setDepartment}
          candidateQ={onboarding.candidateQ}
          onCandidateSearchInput={onboarding.onCandidateSearchInput}
          existingEmployeeId={onboarding.existingEmployeeId}
          onExistingEmployeeIdChange={onboarding.setExistingEmployeeId}
          candidatesState={onboarding.candidatesState}
          candidatesSearchPending={onboarding.candidatesSearchPending}
          candidatesLoadMoreBlocked={onboarding.candidatesLoadMoreBlocked}
          existingCandidates={onboarding.existingCandidates}
          selectedExisting={onboarding.selectedExisting}
          inviteableRoles={onboarding.inviteableRoles}
          issuing={onboarding.issuing}
          issueExistingDisabled={onboarding.issueExistingDisabled}
          issued={onboarding.issued}
          invites={onboarding.invites}
          onIssue={(e) => void onboarding.onIssue(e)}
          onRevoke={(id) => void onboarding.onRevoke(id)}
          onRefreshInvitesClick={() => void onboarding.onRefreshInvitesClick()}
          onLoadMoreCandidates={() => void onboarding.onLoadMoreCandidates()}
        />
      )}

            {devicesPerson && (
        <TeamPersonDevicesDialog
          person={devicesPerson}
          locale={locale}
          canRevoke={
            canManageAccess &&
            canManagePersonAccess(user.role, devicesPerson.role)
          }
          onClose={() => setDevicesPerson(null)}
          onChanged={() => {
            // Fire-and-forget async work without awaiting in this path.
            void directory.reloadDirectoryWithQuery(
              directory.getCommittedDirectoryQuery(),
            );
          }}
          onRevokedOwnDevice={() => {
            // Fire-and-forget async work without awaiting in this path.
            void logout();
          }}
        />
      )}

            {detailPerson && (
        <TeamPersonDetailDialog
          person={detailPerson}
          locale={locale}
          onClose={() => setDetailPerson(null)}
        />
      )}
    </main>
  );
}
