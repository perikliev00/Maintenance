import { ALL_ROLES, ROLE_LABELS, type AuthUser, type Person, type Role } from "../../api/client";
import { LoadingIndicator } from "../../components/LoadingIndicator";
import { t } from "./labels";
import { lifecycleActionsForPerson, normalizePersonStatus } from "./personActions";
import type { LifecycleAction } from "./runLifecycleAction";

export type TeamDirectoryPanelProps = {
  locale: "bg" | "en"; user: AuthUser; canManageAccess: boolean;
  q: string; role: "" | Role; includeInactive: boolean; includeArchived: boolean; notOnboarded: boolean;
  onDirectorySearchInput: (value: string) => void; onRoleChange: (role: "" | Role) => void;
  onIncludeInactiveChange: (value: boolean) => void; onIncludeArchivedChange: (value: boolean) => void;
  onNotOnboardedChange: (value: boolean) => void; onRefreshDirectoryClick: () => void;
  directoryLoading: boolean; loading: boolean; refreshing: boolean; loadingMore: boolean; loadMoreBlocked: boolean;
  people: Person[]; peopleCursor: string | null; lifecycleBusyId: string | null;
  onViewPerson: (person: Person) => void; onDevicesPerson: (person: Person) => void;
  onLifecycleAction: (person: Person, action: LifecycleAction) => void; onLoadMoreDirectory: () => void;
};

/** A people directory: filter context stays alongside individual identity records. */
export function TeamDirectoryPanel(props: TeamDirectoryPanelProps) {
  const { locale, user, people } = props;
  const label = (bg: string, en: string) => t(locale, bg, en);
  const actionLabel = (action: LifecycleAction) => ({
    block: label("Блокирай", "Block"), unblock: label("Отблокирай", "Unblock"),
    archive: label("Премахни от екипа", "Remove from team"), restore: label("Възстанови в екипа", "Restore to team"),
  })[action];
  const statusLabel = (status: string) => ({
    archived: label("архивиран", "archived"), blocked: label("блокиран", "blocked"),
    active: label("активен", "active"), not_activated: label("без активиране", "not activated"),
  })[status] ?? status;
  return (
    <div className="ui-directory-layout">
      <aside className="ui-context-panel" aria-label={label("Филтри за хора", "People filters")}>
        <h2>{label("Намери човек", "Find a person")}</h2>
        <label>{label("Търсене", "Search")}<input value={props.q} onChange={(e) => props.onDirectorySearchInput(e.target.value)} placeholder={label("Име, имейл, номер…", "Name, email, number…")} /></label>
        <label>{label("Роля", "Role")}<select value={props.role} onChange={(e) => props.onRoleChange(e.target.value as "" | Role)}>
          <option value="">{label("Всички роли", "All roles")}</option>
          {ALL_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]} ({role})</option>)}
        </select></label>
        <fieldset><legend>{label("Включи в списъка", "Include in directory")}</legend>
          <label className="checkbox-inline"><input type="checkbox" checked={props.includeInactive} onChange={(e) => props.onIncludeInactiveChange(e.target.checked)} />{label("Покажи блокирани", "Show blocked")}</label>
          <label className="checkbox-inline"><input type="checkbox" checked={props.includeArchived} onChange={(e) => props.onIncludeArchivedChange(e.target.checked)} />{label("Покажи архивирани", "Show archived")}</label>
          <label className="checkbox-inline"><input type="checkbox" checked={props.notOnboarded} onChange={(e) => props.onNotOnboardedChange(e.target.checked)} />{label("Само без onboarding", "Only not onboarded")}</label>
        </fieldset>
        <button type="button" className="ghost" disabled={props.directoryLoading} onClick={props.onRefreshDirectoryClick}>{props.directoryLoading ? label("Опресняване…", "Refreshing…") : label("Опресни", "Refresh")}</button>
        <p className="muted small">{label("„Активен“ означава разрешен и активиран профил. Регистрираните устройства са регистрации с неотнет достъп, а не онлайн брой.", "Active means an allowed and activated profile. Registered devices count registrations with non-revoked access, not devices currently online.")}</p>
      </aside>
      <section className="ui-directory-results" aria-label={label("Служители", "People")} aria-busy={props.directoryLoading}>
        <div className="ui-section-heading"><h2>{label("Хора в екипа", "People in your team")}</h2><span className="muted" aria-live="polite">{people.length} {label("заредени", "loaded")}</span></div>
        {props.loading ? <LoadingIndicator label={label("Зареждане на хора…", "Loading people…")} /> : <>
          {props.refreshing && <p role="status" className="muted">{label("Опресняване…", "Refreshing…")}</p>}
          {people.length === 0 && <div className="ui-empty-state"><h3>{label("Няма съвпадения", "No matching people")}</h3><p>{label("Няма профили по филтрите.", "No profiles match the filters.")}</p></div>}
          <div className="ui-directory-grid">
            {people.map((person) => {
              const status = normalizePersonStatus(person);
              const actions = lifecycleActionsForPerson(person, props.canManageAccess, user.role);
              const busy = props.lifecycleBusyId === person.employeeId;
              return <article className="ui-person-card" key={person.employeeId} aria-label={person.fullName}>
                <header className="ui-person-heading"><span className="ui-avatar" aria-hidden="true">{person.fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span><div><h3>{person.fullName}</h3><span className="muted">{person.employeeNumber}</span></div><span className={`pill status-${status}`}>{statusLabel(status)}</span></header>
                <dl className="ui-record-facts"><div><dt>{label("Роля", "Role")}</dt><dd>{person.role ? ROLE_LABELS[person.role] ?? person.role : "—"}</dd></div><div><dt>{label("Отдел", "Department")}</dt><dd>{person.department ?? "—"}</dd></div><div><dt>Email</dt><dd>{person.email ?? "—"}</dd></div><div><dt>{label("Регистрирани устройства", "Registered devices")}</dt><dd><button type="button" className="linkish" onClick={() => props.onDevicesPerson(person)}>{person.deviceCount}</button></dd></div></dl>
                <footer className="ui-record-actions">
                  {actions.includes("view") && <button type="button" className="ghost" disabled={busy} onClick={() => props.onViewPerson(person)}>{label("Преглед", "View")}</button>}
                  {actions.includes("devices") && <button type="button" className="ghost" disabled={busy} onClick={() => props.onDevicesPerson(person)}>{label("Устройства", "Devices")}</button>}
                  {(["block", "unblock", "archive", "restore"] as const).filter((action) => actions.includes(action)).map((action) => <button key={action} type="button" className="ghost" disabled={busy} onClick={() => props.onLifecycleAction(person, action)}>{busy && action === "block" ? label("Изчакване…", "Working…") : actionLabel(action)}</button>)}
                </footer>
              </article>;
            })}
          </div>
          {props.peopleCursor && <div className="ui-pagination"><button type="button" className="ghost" disabled={props.loadMoreBlocked} onClick={props.onLoadMoreDirectory}>{props.loadingMore ? <LoadingIndicator variant="inline" delayMs={0} label={label("Зареждане…", "Loading…")} /> : label("Още", "Load more")}</button></div>}
        </>}
      </section>
    </div>
  );
}
