/**
 * Manager control desk: role edits, create cleaning tasks, and ticket
 * assign/close/reopen/lifecycle. Role changes are limited by `assignableRolesFor`.
 */
import type { AuthUser } from "../../api/client";
import { ControlCleaningSection } from "./ControlCleaningSection";
import { ControlRolesSection } from "./ControlRolesSection";
import { ControlTicketsSection } from "./ControlTicketsSection";
import { useControlBoard } from "./useControlBoard";

type Props = {
  user: AuthUser;
};

export function ControlPage({ user }: Props) {
  const board = useControlBoard(user);

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>Control</h1>
          <p>Роли, задачи за почистване и отворени проблеми</p>
        </div>
      </header>

      {user.role === "owner" && (
        <div className="owner-banner">
          Роля собственик — пълен контрол: всички роли, всички панели, всички
          действия
        </div>
      )}
      {board.error && <div className="error banner">{board.error}</div>}
      {board.message && <div className="ok banner">{board.message}</div>}
      {board.refreshWarning && (
        <div className="error banner" role="status">
          {board.refreshWarning}
        </div>
      )}

      {board.initialLoading ? (
        <p className="muted">Loading control…</p>
      ) : (
        <div className="control-grid">
          {board.canChangeRole && (
            <ControlRolesSection
              user={board.user}
              allowedRoles={board.allowedRoles}
              people={board.people}
              roleDrafts={board.roleDrafts}
              setRoleDrafts={board.setRoleDrafts}
              searchInput={board.searchInput}
              searchPending={board.searchPending}
              peopleLoading={board.peopleLoading}
              peopleError={board.peopleError}
              onSearchInputChange={board.onSearchInputChange}
              saveRole={board.saveRole}
              savingIds={board.savingIds}
            />
          )}

          {board.canCreateCleaning && (
            <ControlCleaningSection
              rooms={board.rooms}
              housekeepers={board.housekeepers}
              taskRoomId={board.taskRoomId}
              setTaskRoomId={board.setTaskRoomId}
              taskAssignee={board.taskAssignee}
              setTaskAssignee={board.setTaskAssignee}
              taskPriority={board.taskPriority}
              setTaskPriority={board.setTaskPriority}
              creatingTask={board.creatingTask}
              onCreateTask={board.onCreateTask}
              cleaningError={board.cleaningError}
            />
          )}

          {board.canWorkTickets && (
            <ControlTicketsSection
              canAssign={board.canAssign}
              canClose={board.canClose}
              canResolve={board.canResolve}
              tickets={board.tickets}
              resolvedTickets={board.resolvedTickets}
              ticketsError={board.ticketsError}
              recentError={board.recentError}
              technicians={board.technicians}
              assignDrafts={board.assignDrafts}
              setAssignDrafts={board.setAssignDrafts}
              busyIds={board.busyIds}
              beginBusy={board.beginBusy}
              endBusy={board.endBusy}
              refresh={board.refresh}
              setError={board.setError}
              setMessage={board.setMessage}
              setRefreshWarning={board.setRefreshWarning}
              liveAt={board.liveAt}
              onManualRefresh={board.onManualRefresh}
            />
          )}
        </div>
      )}
    </main>
  );
}
