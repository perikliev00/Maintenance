import { ALL_ROLES, ROLE_LABELS, type AuthUser, type Person, type Role } from "../../api/client";
import { LoadingIndicator } from "../../components/LoadingIndicator";
import { t } from "./labels";
import {
  lifecycleActionsForPerson,
  normalizePersonStatus,
} from "./personActions";
import type { LifecycleAction } from "./runLifecycleAction";

export type TeamDirectoryPanelProps = {
  locale: "bg" | "en";
  user: AuthUser;
  canManageAccess: boolean;
  q: string;
  role: "" | Role;
  includeInactive: boolean;
  includeArchived: boolean;
  notOnboarded: boolean;
  onDirectorySearchInput: (value: string) => void;
  onRoleChange: (role: "" | Role) => void;
  onIncludeInactiveChange: (value: boolean) => void;
  onIncludeArchivedChange: (value: boolean) => void;
  onNotOnboardedChange: (value: boolean) => void;
  onRefreshDirectoryClick: () => void;
  directoryLoading: boolean;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  loadMoreBlocked: boolean;
  people: Person[];
  peopleCursor: string | null;
  lifecycleBusyId: string | null;
  onViewPerson: (person: Person) => void;
  onDevicesPerson: (person: Person) => void;
  onLifecycleAction: (person: Person, action: LifecycleAction) => void;
  onLoadMoreDirectory: () => void;
};

export function TeamDirectoryPanel({
  locale,
  user,
  canManageAccess,
  q,
  role,
  includeInactive,
  includeArchived,
  notOnboarded,
  onDirectorySearchInput,
  onRoleChange,
  onIncludeInactiveChange,
  onIncludeArchivedChange,
  onNotOnboardedChange,
  onRefreshDirectoryClick,
  directoryLoading,
  loading,
  refreshing,
  loadingMore,
  loadMoreBlocked,
  people,
  peopleCursor,
  lifecycleBusyId,
  onViewPerson,
  onDevicesPerson,
  onLifecycleAction,
  onLoadMoreDirectory,
}: TeamDirectoryPanelProps) {
  return (
    <>
      <div className="toolbar">
        <label>
          {t(locale, "Търсене", "Search")}
          <input
            value={q}
            onChange={(e) => onDirectorySearchInput(e.target.value)}
            placeholder={t(
              locale,
              "Име, имейл, номер…",
              "Name, email, number…",
            )}
          />
        </label>
        <label>
          {t(locale, "Роля", "Role")}
          <select
            value={role}
            onChange={(e) => onRoleChange(e.target.value as "" | Role)}
          >
            <option value="">{t(locale, "Всички роли", "All roles")}</option>
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
            onChange={(e) => onIncludeInactiveChange(e.target.checked)}
          />
          {t(locale, "Покажи блокирани", "Show blocked")}
        </label>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => onIncludeArchivedChange(e.target.checked)}
          />
          {t(locale, "Покажи архивирани", "Show archived")}
        </label>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={notOnboarded}
            onChange={(e) => onNotOnboardedChange(e.target.checked)}
          />
          {t(locale, "Само без onboarding", "Only not onboarded")}
        </label>
        <button
          type="button"
          className="ghost"
          onClick={() => void onRefreshDirectoryClick()}
          disabled={directoryLoading}
        >
          {directoryLoading
            ? t(locale, "Опресняване…", "Refreshing…")
            : t(locale, "Опресни", "Refresh")}
        </button>
      </div>

      {loading ? (
        <LoadingIndicator
          label={t(locale, "Зареждане на хора…", "Loading people…")}
        />
      ) : (
        <>
          {refreshing && (
            <p className="muted small">
              {t(locale, "Опресняване…", "Refreshing…")}
            </p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t(locale, "Име", "Name")}</th>
                  <th>{t(locale, "Номер", "Number")}</th>
                  <th>Email</th>
                  <th>{t(locale, "Роля", "Role")}</th>
                  <th>{t(locale, "Отдел", "Department")}</th>
                  <th
                    title={t(
                      locale,
                      "Регистрации чрез активиране с неотнет достъп — не онлайн устройства, физически телефони или всички активни сесии",
                      "Registrations via activation with non-revoked access — not online devices, physical phones, or all active sessions",
                    )}
                  >
                    {t(
                      locale,
                      "Регистрирани устройства",
                      "Registered devices",
                    )}
                  </th>
                  <th>{t(locale, "Статус", "Status")}</th>
                  <th>{t(locale, "Действия", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {people.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="muted">
                      {t(
                        locale,
                        "Няма профили по филтрите.",
                        "No profiles match the filters.",
                      )}
                    </td>
                  </tr>
                ) : (
                  people.map((person) => {
                    const status = normalizePersonStatus(person);
                    const actions = lifecycleActionsForPerson(
                      person,
                      canManageAccess,
                      user.role,
                    );
                    const busy = lifecycleBusyId === person.employeeId;
                    return (
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
                        <td>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => onDevicesPerson(person)}
                          >
                            {person.deviceCount}
                          </button>
                        </td>
                        <td>
                          {status === "archived" ? (
                            <span className="pill ready-not_ready">
                              {t(locale, "архивиран", "archived")}
                            </span>
                          ) : status === "blocked" ? (
                            <span
                              className="pill ready-not_ready"
                              title={t(
                                locale,
                                "Блокиран акаунт",
                                "Blocked account",
                              )}
                            >
                              {t(locale, "блокиран", "blocked")}
                            </span>
                          ) : status === "active" ? (
                            <span
                              className="pill ready-ready"
                              title={t(
                                locale,
                                "Разрешен и активиран профил",
                                "Allowed and activated profile",
                              )}
                            >
                              {t(locale, "активен", "active")}
                            </span>
                          ) : (
                            <span className="pill ready-needs_check">
                              {t(
                                locale,
                                "без активиране",
                                "not activated",
                              )}
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="toolbar">
                            {actions.includes("view") && (
                              <button
                                type="button"
                                className="ghost"
                                disabled={busy}
                                onClick={() => onViewPerson(person)}
                              >
                                {t(locale, "Преглед", "View")}
                              </button>
                            )}
                            {actions.includes("devices") && (
                              <button
                                type="button"
                                className="ghost"
                                disabled={busy}
                                onClick={() => onDevicesPerson(person)}
                              >
                                {t(locale, "Устройства", "Devices")}
                              </button>
                            )}
                            {actions.includes("block") && (
                              <button
                                type="button"
                                className="ghost"
                                disabled={busy}
                                onClick={() =>
                                  void onLifecycleAction(person, "block")
                                }
                              >
                                {busy
                                  ? t(locale, "Изчакване…", "Working…")
                                  : t(locale, "Блокирай", "Block")}
                              </button>
                            )}
                            {actions.includes("unblock") && (
                              <button
                                type="button"
                                className="ghost"
                                disabled={busy}
                                onClick={() =>
                                  void onLifecycleAction(person, "unblock")
                                }
                              >
                                {t(locale, "Отблокирай", "Unblock")}
                              </button>
                            )}
                            {actions.includes("archive") && (
                              <button
                                type="button"
                                className="ghost"
                                disabled={busy}
                                onClick={() =>
                                  void onLifecycleAction(person, "archive")
                                }
                              >
                                {t(
                                  locale,
                                  "Премахни от екипа",
                                  "Remove from team",
                                )}
                              </button>
                            )}
                            {actions.includes("restore") && (
                              <button
                                type="button"
                                className="ghost"
                                disabled={busy}
                                onClick={() =>
                                  void onLifecycleAction(person, "restore")
                                }
                              >
                                {t(
                                  locale,
                                  "Възстанови в екипа",
                                  "Restore to team",
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {peopleCursor && (
            <div className="toolbar">
              <button
                type="button"
                className="ghost"
                disabled={loadMoreBlocked}
                onClick={() => void onLoadMoreDirectory()}
              >
                {loadingMore ? (
                  <LoadingIndicator
                    variant="inline"
                    delayMs={0}
                    label={t(locale, "Зареждане…", "Loading…")}
                  />
                ) : (
                  t(locale, "Още", "Load more")
                )}
              </button>
            </div>
          )}
          <p className="muted small">
            {t(
              locale,
              "„Активен“ = разрешен и активиран профил. „Регистрирани устройства“ = регистрации чрез активиране с неотнет достъп, не онлайн брой.",
              "“Active” = allowed and activated profile. “Registered devices” = activation registrations with non-revoked access, not online count.",
            )}
          </p>
        </>
      )}
    </>
  );
}
