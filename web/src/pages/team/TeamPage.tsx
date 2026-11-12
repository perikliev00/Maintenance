/**
 * People directory + onboarding invitations. Invite/revoke UI requires
 * `people.invite`; non-owners cannot invite owner/admin roles.
 */
import { useCallback, useRef, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  canManagePersonAccess,
  // Support the surrounding logic for this step.
  canPerformAction,
  // Support the surrounding logic for this step.
  logout,
  // Declare type alias AuthUser.
  type AuthUser,
  // Declare type alias Person.
  type Person,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ./labels.
import { t } from "./labels";
// Import module dependency from ./runLifecycleAction.
import { runLifecycleAction } from "./runLifecycleAction";
// Import module dependency from ./TeamDirectoryPanel.
import { TeamDirectoryPanel } from "./TeamDirectoryPanel";
// Import module dependency from ./TeamOnboardingPanel.
import { TeamOnboardingPanel } from "./TeamOnboardingPanel";
// Import module dependency from ./TeamPersonDetailDialog.
import { TeamPersonDetailDialog } from "./TeamPersonDetailDialog";
// Import module dependency from ./TeamPersonDevicesDialog.
import { TeamPersonDevicesDialog } from "./TeamPersonDevicesDialog";
// Import module dependency from ./useTeamDirectory.
import { useTeamDirectory } from "./useTeamDirectory";
// Import module dependency from ./useTeamOnboarding.
import { useTeamOnboarding } from "./useTeamOnboarding";

// Declare type alias Props.
type Props = {
  // Provide user field used by this structure.
  user: AuthUser;
  // Support the surrounding logic for this step.
  locale?: "bg" | "en";
};

// Declare type alias Tab.
type Tab = "directory" | "onboarding";

// Export function TeamPage as part of this module's API.
export function TeamPage({ user, locale = "bg" }: Props) {
  // Bind canInvite for use in the following logic.
  const canInvite = canPerformAction(user, "people.invite");
  // Bind canManageAccess for use in the following logic.
  const canManageAccess = canPerformAction(user, "people.manage_access");
  // React state slot for local UI/data that can change over time.
  const [tab, setTab] = useState<Tab>("directory");
  // React state slot for local UI/data that can change over time.
  const [bannerError, setBannerError] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [lifecycleBusyId, setLifecycleBusyId] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [devicesPerson, setDevicesPerson] = useState<Person | null>(null);
  // React state slot for local UI/data that can change over time.
  const [detailPerson, setDetailPerson] = useState<Person | null>(null);

  // Bind refreshInvitesRef for use in the following logic.
  const refreshInvitesRef = useRef<(() => Promise<void>) | undefined>(
    // Support the surrounding logic for this step.
    undefined,
  );

  // Memoize callback identity for stable child/effect deps.
  const onFiltersReloadSideEffects = useCallback(async () => {
    // Conditional branch for the case described by this guard.
    if (!canInvite) return;
    // Begin guarded block to catch runtime failures.
    try {
      // Wait for an async operation before continuing.
      await refreshInvitesRef.current?.();
    // Support the surrounding logic for this step.
    } catch {
      // refreshInvites sets banner
    }
  // Support the surrounding logic for this step.
  }, [canInvite]);

  // Invoke useTeamDirectory hook for page/feature state and behavior.
  const directory = useTeamDirectory({
    // Support the surrounding logic for this step.
    locale,
    // Support the surrounding logic for this step.
    setBannerError,
    // Support the surrounding logic for this step.
    onFiltersReloadSideEffects,
  });

  // Invoke useTeamOnboarding hook for page/feature state and behavior.
  const onboarding = useTeamOnboarding({
    // Support the surrounding logic for this step.
    user,
    // Support the surrounding logic for this step.
    locale,
    // Support the surrounding logic for this step.
    canInvite,
    // Support the surrounding logic for this step.
    tab,
    // Support the surrounding logic for this step.
    setBannerError,
    // Provide reloadDirectory field used by this structure.
    reloadDirectory: directory.reloadDirectory,
  });

  // Support the surrounding logic for this step.
  refreshInvitesRef.current = onboarding.refreshInvites;

  // Bind displayError for use in the following logic.
  const displayError =
    // Support the surrounding logic for this step.
    bannerError ||
    // Support the surrounding logic for this step.
    (tab === "directory" ? directory.loadError : null) ||
    // Support the surrounding logic for this step.
    (tab === "onboarding" && onboarding.inviteKind === "existing"
      // Support the surrounding logic for this step.
      ? onboarding.candidatesLoadError
      // Support the surrounding logic for this step.
      : null);

  // Memoize callback identity for stable child/effect deps.
  const handleLifecycleAction = useCallback(
    // Support the surrounding logic for this step.
    (person: Person, action: Parameters<typeof runLifecycleAction>[1]) => {
      // Fire-and-forget async work without awaiting in this path.
      void runLifecycleAction(person, action, {
        // Support the surrounding logic for this step.
        locale,
        // Support the surrounding logic for this step.
        lifecycleBusyId,
        // Support the surrounding logic for this step.
        setLifecycleBusyId,
        // Support the surrounding logic for this step.
        setBannerError,
        // Support the surrounding logic for this step.
        setDetailPerson,
        // Provide getCommittedDirectoryQuery field used by this structure.
        getCommittedDirectoryQuery: directory.getCommittedDirectoryQuery,
        // Provide reloadDirectoryWithQuery field used by this structure.
        reloadDirectoryWithQuery: directory.reloadDirectoryWithQuery,
      });
    },
    [
      // Support the surrounding logic for this step.
      locale,
      // Support the surrounding logic for this step.
      lifecycleBusyId,
      // Support the surrounding logic for this step.
      directory.getCommittedDirectoryQuery,
      // Support the surrounding logic for this step.
      directory.reloadDirectoryWithQuery,
    ],
  );

  // Return the JSX/UI tree for this render path.
  return (
    // Render a <main> element for layout or semantics.
    <main className="content">
      <header className="page-header">
        <div>
          <h1>{t(locale, "Екип", "Team")}</h1>
          <p>
            {t(
              // Support the surrounding logic for this step.
              locale,
              // Support the surrounding logic for this step.
              "Хора, роли, onboarding и устройства",
              // Support the surrounding logic for this step.
              "People, roles, onboarding and devices",
            )}
          </p>
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented" role="tablist">
          <button
            // Declare a type alias.
            type="button"
            // Pass className prop/value into the element or config.
            className={tab === "directory" ? "active" : ""}
            // Pass onClick prop/value into the element or config.
            onClick={() => setTab("directory")}
          >
            {t(locale, "Списък", "Directory")}
          </button>
          {canInvite && (
            // Render a <button> element for layout or semantics.
            <button
              // Declare a type alias.
              type="button"
              // Pass className prop/value into the element or config.
              className={tab === "onboarding" ? "active" : ""}
              // Pass onClick prop/value into the element or config.
              onClick={() => setTab("onboarding")}
            >
              // Support the surrounding logic for this step.
              Onboarding
            </button>
          )}
        </div>
      </div>

      // Support the surrounding logic for this step.
      {displayError && <div className="error banner">{displayError}</div>}
      // Support the surrounding logic for this step.
      {onboarding.inviteMessage && tab === "onboarding" && (
        // Render a <div> element for layout or semantics.
        <div className="ok banner">{onboarding.inviteMessage}</div>
      )}

      // Support the surrounding logic for this step.
      {tab === "directory" && (
        // Render TeamDirectoryPanel as part of this view composition.
        <TeamDirectoryPanel
          // Pass locale prop/value into the element or config.
          locale={locale}
          // Pass user prop/value into the element or config.
          user={user}
          // Pass canManageAccess prop/value into the element or config.
          canManageAccess={canManageAccess}
          // Pass q prop/value into the element or config.
          q={directory.q}
          // Pass role prop/value into the element or config.
          role={directory.role}
          // Pass includeInactive prop/value into the element or config.
          includeInactive={directory.includeInactive}
          // Pass includeArchived prop/value into the element or config.
          includeArchived={directory.includeArchived}
          // Pass notOnboarded prop/value into the element or config.
          notOnboarded={directory.notOnboarded}
          // Pass onDirectorySearchInput prop/value into the element or config.
          onDirectorySearchInput={directory.onDirectorySearchInput}
          // Pass onRoleChange prop/value into the element or config.
          onRoleChange={directory.setRole}
          // Pass onIncludeInactiveChange prop/value into the element or config.
          onIncludeInactiveChange={directory.setIncludeInactive}
          // Pass onIncludeArchivedChange prop/value into the element or config.
          onIncludeArchivedChange={directory.setIncludeArchived}
          // Pass onNotOnboardedChange prop/value into the element or config.
          onNotOnboardedChange={directory.setNotOnboarded}
          // Pass onRefreshDirectoryClick prop/value into the element or config.
          onRefreshDirectoryClick={() => void directory.onRefreshDirectoryClick()}
          // Pass directoryLoading prop/value into the element or config.
          directoryLoading={directory.directoryState.loading}
          // Pass loading prop/value into the element or config.
          loading={directory.loading}
          // Pass refreshing prop/value into the element or config.
          refreshing={directory.refreshing}
          // Pass loadingMore prop/value into the element or config.
          loadingMore={directory.loadingMore}
          // Pass loadMoreBlocked prop/value into the element or config.
          loadMoreBlocked={directory.loadMoreBlocked}
          // Pass people prop/value into the element or config.
          people={directory.people}
          // Pass peopleCursor prop/value into the element or config.
          peopleCursor={directory.peopleCursor}
          // Pass lifecycleBusyId prop/value into the element or config.
          lifecycleBusyId={lifecycleBusyId}
          // Pass onViewPerson prop/value into the element or config.
          onViewPerson={setDetailPerson}
          // Pass onDevicesPerson prop/value into the element or config.
          onDevicesPerson={setDevicesPerson}
          // Pass onLifecycleAction prop/value into the element or config.
          onLifecycleAction={handleLifecycleAction}
          // Pass onLoadMoreDirectory prop/value into the element or config.
          onLoadMoreDirectory={() => void directory.onLoadMoreDirectory()}
        />
      )}

      // Support the surrounding logic for this step.
      {tab === "onboarding" && canInvite && (
        // Render TeamOnboardingPanel as part of this view composition.
        <TeamOnboardingPanel
          // Pass locale prop/value into the element or config.
          locale={locale}
          // Pass inviteKind prop/value into the element or config.
          inviteKind={onboarding.inviteKind}
          // Pass onInviteKindChange prop/value into the element or config.
          onInviteKindChange={onboarding.setInviteKind}
          // Pass fullName prop/value into the element or config.
          fullName={onboarding.fullName}
          // Pass onFullNameChange prop/value into the element or config.
          onFullNameChange={onboarding.setFullName}
          // Pass employeeNumber prop/value into the element or config.
          employeeNumber={onboarding.employeeNumber}
          // Pass onEmployeeNumberChange prop/value into the element or config.
          onEmployeeNumberChange={onboarding.setEmployeeNumber}
          // Pass email prop/value into the element or config.
          email={onboarding.email}
          // Pass onEmailChange prop/value into the element or config.
          onEmailChange={onboarding.setEmail}
          // Pass inviteRole prop/value into the element or config.
          inviteRole={onboarding.inviteRole}
          // Pass onInviteRoleChange prop/value into the element or config.
          onInviteRoleChange={onboarding.setInviteRole}
          // Pass department prop/value into the element or config.
          department={onboarding.department}
          // Pass onDepartmentChange prop/value into the element or config.
          onDepartmentChange={onboarding.setDepartment}
          // Pass candidateQ prop/value into the element or config.
          candidateQ={onboarding.candidateQ}
          // Pass onCandidateSearchInput prop/value into the element or config.
          onCandidateSearchInput={onboarding.onCandidateSearchInput}
          // Pass existingEmployeeId prop/value into the element or config.
          existingEmployeeId={onboarding.existingEmployeeId}
          // Pass onExistingEmployeeIdChange prop/value into the element or config.
          onExistingEmployeeIdChange={onboarding.setExistingEmployeeId}
          // Pass candidatesState prop/value into the element or config.
          candidatesState={onboarding.candidatesState}
          // Pass candidatesSearchPending prop/value into the element or config.
          candidatesSearchPending={onboarding.candidatesSearchPending}
          // Pass candidatesLoadMoreBlocked prop/value into the element or config.
          candidatesLoadMoreBlocked={onboarding.candidatesLoadMoreBlocked}
          // Pass existingCandidates prop/value into the element or config.
          existingCandidates={onboarding.existingCandidates}
          // Pass selectedExisting prop/value into the element or config.
          selectedExisting={onboarding.selectedExisting}
          // Pass inviteableRoles prop/value into the element or config.
          inviteableRoles={onboarding.inviteableRoles}
          // Pass issuing prop/value into the element or config.
          issuing={onboarding.issuing}
          // Pass issueExistingDisabled prop/value into the element or config.
          issueExistingDisabled={onboarding.issueExistingDisabled}
          // Pass issued prop/value into the element or config.
          issued={onboarding.issued}
          // Pass invites prop/value into the element or config.
          invites={onboarding.invites}
          // Pass onIssue prop/value into the element or config.
          onIssue={(e) => void onboarding.onIssue(e)}
          // Pass onRevoke prop/value into the element or config.
          onRevoke={(id) => void onboarding.onRevoke(id)}
          // Pass onRefreshInvitesClick prop/value into the element or config.
          onRefreshInvitesClick={() => void onboarding.onRefreshInvitesClick()}
          // Pass onLoadMoreCandidates prop/value into the element or config.
          onLoadMoreCandidates={() => void onboarding.onLoadMoreCandidates()}
        />
      )}

      // Support the surrounding logic for this step.
      {devicesPerson && (
        // Render TeamPersonDevicesDialog as part of this view composition.
        <TeamPersonDevicesDialog
          // Pass person prop/value into the element or config.
          person={devicesPerson}
          // Pass locale prop/value into the element or config.
          locale={locale}
          // Pass canRevoke prop/value into the element or config.
          canRevoke={
            // Support the surrounding logic for this step.
            canManageAccess &&
            // Invoke canManagePersonAccess to perform this step.
            canManagePersonAccess(user.role, devicesPerson.role)
          }
          // Pass onClose prop/value into the element or config.
          onClose={() => setDevicesPerson(null)}
          // Pass onChanged prop/value into the element or config.
          onChanged={() => {
            // Fire-and-forget async work without awaiting in this path.
            void directory.reloadDirectoryWithQuery(
              // Invoke directory.getCommittedDirectoryQuery to perform this step.
              directory.getCommittedDirectoryQuery(),
            );
          }}
          // Pass onRevokedOwnDevice prop/value into the element or config.
          onRevokedOwnDevice={() => {
            // Fire-and-forget async work without awaiting in this path.
            void logout();
          }}
        />
      )}

      // Support the surrounding logic for this step.
      {detailPerson && (
        // Render TeamPersonDetailDialog as part of this view composition.
        <TeamPersonDetailDialog
          // Pass person prop/value into the element or config.
          person={detailPerson}
          // Pass locale prop/value into the element or config.
          locale={locale}
          // Pass onClose prop/value into the element or config.
          onClose={() => setDetailPerson(null)}
        />
      )}
    </main>
  );
}
