/**
 * Manager control desk: role edits, create cleaning tasks, and ticket
 * assign/close/reopen/lifecycle. Role changes are limited by `assignableRolesFor`.
 */
import type { AuthUser } from "../../api/client";
// Import module dependency from ./ControlCleaningSection.
import { ControlCleaningSection } from "./ControlCleaningSection";
// Import module dependency from ./ControlRolesSection.
import { ControlRolesSection } from "./ControlRolesSection";
// Import module dependency from ./ControlTicketsSection.
import { ControlTicketsSection } from "./ControlTicketsSection";
// Import module dependency from ./useControlBoard.
import { useControlBoard } from "./useControlBoard";

// Declare type alias Props.
type Props = {
  // Provide user field used by this structure.
  user: AuthUser;
};

// Export function ControlPage as part of this module's API.
export function ControlPage({ user }: Props) {
  // Invoke useControlBoard hook for page/feature state and behavior.
  const board = useControlBoard(user);

  // Return the JSX/UI tree for this render path.
  return (
    // Render a <main> element for layout or semantics.
    <main className="content">
      <header className="page-header">
        <div>
          <h1>Control</h1>
          <p>Роли, задачи за почистване и отворени проблеми</p>
        </div>
      </header>

      {user.role === "owner" && (
        // Render a <div> element for layout or semantics.
        <div className="owner-banner">
          // Support the surrounding logic for this step.
          Роля собственик — пълен контрол: всички роли, всички панели, всички
          // Support the surrounding logic for this step.
          действия
        </div>
      )}
      {board.error && <div className="error banner">{board.error}</div>}
      {board.message && <div className="ok banner">{board.message}</div>}
      {board.refreshWarning && (
        // Render a <div> element for layout or semantics.
        <div className="error banner" role="status">
          // Support the surrounding logic for this step.
          {board.refreshWarning}
        </div>
      )}

      {board.initialLoading ? (
        // Render a <p> element for layout or semantics.
        <p className="muted">Loading control…</p>
      // Support the surrounding logic for this step.
      ) : (
        // Render a <div> element for layout or semantics.
        <div className="control-grid">
          // Support the surrounding logic for this step.
          {board.canChangeRole && (
            // Render ControlRolesSection as part of this view composition.
            <ControlRolesSection
              // Pass user prop/value into the element or config.
              user={board.user}
              // Pass allowedRoles prop/value into the element or config.
              allowedRoles={board.allowedRoles}
              // Pass people prop/value into the element or config.
              people={board.people}
              // Pass roleDrafts prop/value into the element or config.
              roleDrafts={board.roleDrafts}
              // Pass setRoleDrafts prop/value into the element or config.
              setRoleDrafts={board.setRoleDrafts}
              // Pass searchInput prop/value into the element or config.
              searchInput={board.searchInput}
              // Pass searchPending prop/value into the element or config.
              searchPending={board.searchPending}
              // Pass peopleLoading prop/value into the element or config.
              peopleLoading={board.peopleLoading}
              // Pass peopleError prop/value into the element or config.
              peopleError={board.peopleError}
              // Pass onSearchInputChange prop/value into the element or config.
              onSearchInputChange={board.onSearchInputChange}
              // Pass saveRole prop/value into the element or config.
              saveRole={board.saveRole}
              // Pass savingIds prop/value into the element or config.
              savingIds={board.savingIds}
            />
          )}

          // Support the surrounding logic for this step.
          {board.canCreateCleaning && (
            // Render ControlCleaningSection as part of this view composition.
            <ControlCleaningSection
              // Pass rooms prop/value into the element or config.
              rooms={board.rooms}
              // Pass housekeepers prop/value into the element or config.
              housekeepers={board.housekeepers}
              // Pass taskRoomId prop/value into the element or config.
              taskRoomId={board.taskRoomId}
              // Pass setTaskRoomId prop/value into the element or config.
              setTaskRoomId={board.setTaskRoomId}
              // Pass taskAssignee prop/value into the element or config.
              taskAssignee={board.taskAssignee}
              // Pass setTaskAssignee prop/value into the element or config.
              setTaskAssignee={board.setTaskAssignee}
              // Pass taskPriority prop/value into the element or config.
              taskPriority={board.taskPriority}
              // Pass setTaskPriority prop/value into the element or config.
              setTaskPriority={board.setTaskPriority}
              // Pass creatingTask prop/value into the element or config.
              creatingTask={board.creatingTask}
              // Pass onCreateTask prop/value into the element or config.
              onCreateTask={board.onCreateTask}
              // Pass cleaningError prop/value into the element or config.
              cleaningError={board.cleaningError}
            />
          )}

          // Support the surrounding logic for this step.
          {board.canWorkTickets && (
            // Render ControlTicketsSection as part of this view composition.
            <ControlTicketsSection
              // Pass canAssign prop/value into the element or config.
              canAssign={board.canAssign}
              // Pass canClose prop/value into the element or config.
              canClose={board.canClose}
              // Pass canResolve prop/value into the element or config.
              canResolve={board.canResolve}
              // Pass tickets prop/value into the element or config.
              tickets={board.tickets}
              // Pass resolvedTickets prop/value into the element or config.
              resolvedTickets={board.resolvedTickets}
              // Pass ticketsError prop/value into the element or config.
              ticketsError={board.ticketsError}
              // Pass recentError prop/value into the element or config.
              recentError={board.recentError}
              // Pass technicians prop/value into the element or config.
              technicians={board.technicians}
              // Pass assignDrafts prop/value into the element or config.
              assignDrafts={board.assignDrafts}
              // Pass setAssignDrafts prop/value into the element or config.
              setAssignDrafts={board.setAssignDrafts}
              // Pass busyIds prop/value into the element or config.
              busyIds={board.busyIds}
              // Pass beginBusy prop/value into the element or config.
              beginBusy={board.beginBusy}
              // Pass endBusy prop/value into the element or config.
              endBusy={board.endBusy}
              // Pass refreshTickets prop/value into the element or config.
              refreshTickets={board.refreshTickets}
              // Pass setError prop/value into the element or config.
              setError={board.setError}
              // Pass setMessage prop/value into the element or config.
              setMessage={board.setMessage}
              // Pass setRefreshWarning prop/value into the element or config.
              setRefreshWarning={board.setRefreshWarning}
              // Pass liveAt prop/value into the element or config.
              liveAt={board.liveAt}
              // Pass onManualRefresh prop/value into the element or config.
              onManualRefresh={board.onManualRefresh}
            />
          )}
        </div>
      )}
    </main>
  );
}
