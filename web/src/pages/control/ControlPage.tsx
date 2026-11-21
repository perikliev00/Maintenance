/**
 * Manager control desk: role edits, create cleaning tasks, and ticket
 * assign/close/reopen/lifecycle. Role changes are limited by `assignableRolesFor`.
 */
import { useState } from "react";
import type { AuthUser } from "../../api/client";
import { EmptyState, SectionNav, Workspace, WorkspaceIntro } from "../../ui";
import { ControlCleaningSection } from "./ControlCleaningSection";
import { ControlRolesSection } from "./ControlRolesSection";
import { ControlTicketsSection } from "./ControlTicketsSection";
import { useControlBoard } from "./useControlBoard";

type Props = {
  user: AuthUser;
};

// Export function ControlPage as part of this module's API.
export function ControlPage({ user }: Props) {
  // Invoke useControlBoard hook for page/feature state and behavior.
  const board = useControlBoard(user);
  const [section, setSection] = useState("repairs");
  const sections = [
    ...(board.canWorkTickets ? [{ id: "repairs", label: "Проблеми и ремонти", description: "Назначаване, решение и потвърждение" }] : []),
    ...(board.canCreateCleaning ? [{ id: "cleaning", label: "Нова задача за почистване", description: "Локация, приоритет и изпълнител" }] : []),
    ...(board.canChangeRole ? [{ id: "access", label: "Роли на екипа", description: "Отговорности и достъп" }] : []),
  ];
  const activeSection = sections.some((item) => item.id === section) ? section : sections[0]?.id;

  return (
    <Workspace className="ui-control-workspace">
      <WorkspaceIntro eyebrow="ОПЕРАТИВНИ РЕШЕНИЯ" title="Control" description="Изберете работен процес. Разпределете работа, проследете решенията и управлявайте отговорностите." />

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

      <div className="ui-section-layout">
        <aside>
          <SectionNav label="Control sections" items={sections} value={activeSection ?? ""} onChange={setSection} />
          <div className="ui-context-note"><strong>Ясна отговорност</strong><p>Действията се изпълняват с текущите ви права и се записват в историята.</p></div>
        </aside>
        <div className="ui-section-content">
      {board.initialLoading ? (
        <p className="muted">Loading control…</p>
      ) : (
        <div className="ui-decision-workspace">
                    {board.canChangeRole && activeSection === "access" && (
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

                    {board.canCreateCleaning && activeSection === "cleaning" && (
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

                    {board.canWorkTickets && activeSection === "repairs" && (
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
              refreshTickets={board.refreshTickets}
              setError={board.setError}
              setMessage={board.setMessage}
              setRefreshWarning={board.setRefreshWarning}
              liveAt={board.liveAt}
              onManualRefresh={board.onManualRefresh}
            />
          )}
        </div>
      )}
      {!board.initialLoading && sections.length === 0 && <EmptyState title="Няма достъпни действия" description="За този профил няма предоставени оперативни действия." />}
        </div>
      </div>
    </Workspace>
  );
}
