/**
 * People directory + onboarding invitations. Invite/revoke UI requires
 * `people.invite`; non-owners cannot invite owner/admin roles.
 *
 * Directory and Existing lists use peopleListSession so filter/Refresh replace
 * cannot race Load more. Search uses debouncedSearch: invalidate immediately on
 * type, fetch only after debounce; Refresh uses the current input text.
 */
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_ROLES,
  ApiRequestError,
  ROLE_LABELS,
  archivePerson,
  blockPerson,
  canPerformAction,
  deviceFingerprint,
  fetchInvitations,
  fetchPeoplePage,
  issueInvitation,
  logout,
  restorePerson,
  revokeInvitation,
  unblockPerson,
  type AuthUser,
  type Invitation,
  type IssuedInvitation,
  type Person,
  type Role,
} from "../api/client";
import { createDebouncedSearch, type DebouncedSearchBridge } from "./team/debouncedSearch";
import { t } from "./team/labels";
import {
  canManagePersonAccess,
  lifecycleActionsForPerson,
  normalizePersonStatus,
} from "./team/personActions";
import {
  createPeopleListSession,
  runPeopleFullReload,
  runPeopleLoadMore,
  type PeopleListViewState,
} from "./team/peopleListSession";
import { TeamPersonDetailDialog } from "./team/TeamPersonDetailDialog";
import { TeamPersonDevicesDialog } from "./team/TeamPersonDevicesDialog";

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
};

type Tab = "directory" | "onboarding";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * People directory + onboarding invitations UI.
 * Invite/revoke requires `people.invite`; non-owners cannot invite owner/admin.
 */
export function TeamPage({ user, locale = "bg" }: Props) {
  const issueInFlight = useRef(false);
  const canInvite = canPerformAction(user, "people.invite");
  const canManageAccess = canPerformAction(user, "people.manage_access");
  const [tab, setTab] = useState<Tab>("directory");

  const [q, setQ] = useState("");
  const [role, setRole] = useState<"" | Role>("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [notOnboarded, setNotOnboarded] = useState(false);
  const [directoryLoadedOnce, setDirectoryLoadedOnce] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [lifecycleBusyId, setLifecycleBusyId] = useState<string | null>(null);
  const [devicesPerson, setDevicesPerson] = useState<Person | null>(null);
  const [detailPerson, setDetailPerson] = useState<Person | null>(null);

  const [directoryState, setDirectoryState] = useState<PeopleListViewState>({
    people: [],
    nextCursor: null,
    loadError: null,
    loading: true,
    loadingMore: false,
  });
  const directorySessionRef = useRef(
    createPeopleListSession((next) => setDirectoryState({ ...next })),
  );

  const [invites, setInvites] = useState<Invitation[]>([]);
  const [inviteKind, setInviteKind] = useState<"new" | "existing">("new");
  const [fullName, setFullName] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("housekeeper");
  const [department, setDepartment] = useState("");
  const [existingEmployeeId, setExistingEmployeeId] = useState("");
  const [candidateQ, setCandidateQ] = useState("");
  const [candidatesState, setCandidatesState] = useState<PeopleListViewState>({
    people: [],
    nextCursor: null,
    loadError: null,
    loading: false,
    loadingMore: false,
  });
  const candidatesSessionRef = useRef(
    createPeopleListSession((next) => setCandidatesState({ ...next })),
  );
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  const directoryFiltersRef = useRef({
    role,
    includeInactive,
    includeArchived,
    notOnboarded,
  });
  directoryFiltersRef.current = {
    role,
    includeInactive,
    includeArchived,
    notOnboarded,
  };

  const inviteableRoles = useMemo(() => {
    if (user.role === "owner") return ALL_ROLES;
    return ALL_ROLES.filter((r) => r !== "owner" && r !== "admin");
  }, [user.role]);

  const existingCandidates = useMemo(
    () =>
      candidatesState.people.filter((p) => {
        if (!p.isActive) return false;
        if (p.role && !inviteableRoles.includes(p.role)) return false;
        return true;
      }),
    [candidatesState.people, inviteableRoles],
  );

  const selectedExisting = existingCandidates.find(
    (p) => p.employeeId === existingEmployeeId,
  );

  const mapPeopleError = useCallback(
    (err: unknown) =>
      err instanceof Error
        ? err.message
        : t(locale, "Неуспешно зареждане на хората", "Failed to load people"),
    [locale],
  );

  const mapCandidatesError = useCallback(
    (err: unknown) =>
      err instanceof Error
        ? err.message
        : t(
            locale,
            "Неуспешно зареждане на кандидати",
            "Failed to load invite candidates",
          ),
    [locale],
  );

  const reloadDirectoryWithQuery = useCallback(
    async (query: string) => {
      setBannerError(null);
      const filters = directoryFiltersRef.current;
      await runPeopleFullReload(
        directorySessionRef.current,
        (args) =>
          fetchPeoplePage(
            {
              q: query || undefined,
              role: filters.role || undefined,
              includeInactive: filters.includeInactive,
              includeArchived: filters.includeArchived,
              notOnboarded: filters.notOnboarded || undefined,
              limit: PAGE_SIZE,
            },
            { signal: args.signal },
          ),
        mapPeopleError,
      );
      setDirectoryLoadedOnce(true);
    },
    [mapPeopleError],
  );

  const reloadCandidatesWithQuery = useCallback(
    async (query: string) => {
      if (!canInvite) return;
      setBannerError(null);
      await runPeopleFullReload(
        candidatesSessionRef.current,
        (args) =>
          fetchPeoplePage(
            {
              q: query || undefined,
              includeInactive: false,
              limit: PAGE_SIZE,
            },
            { signal: args.signal },
          ),
        mapCandidatesError,
      );
    },
    [canInvite, mapCandidatesError],
  );

  const reloadDirectoryWithQueryRef = useRef(reloadDirectoryWithQuery);
  reloadDirectoryWithQueryRef.current = reloadDirectoryWithQuery;
  const reloadCandidatesWithQueryRef = useRef(reloadCandidatesWithQuery);
  reloadCandidatesWithQueryRef.current = reloadCandidatesWithQuery;

  const directorySearchRef = useRef<DebouncedSearchBridge | null>(null);
  if (directorySearchRef.current === null) {
    directorySearchRef.current = createDebouncedSearch({
      debounceMs: SEARCH_DEBOUNCE_MS,
      onInvalidate: () => {
        directorySessionRef.current.invalidatePendingSearch();
      },
      onCommit: (committed) => {
        void reloadDirectoryWithQueryRef.current(committed);
      },
    });
  }

  const candidatesSearchRef = useRef<DebouncedSearchBridge | null>(null);
  if (candidatesSearchRef.current === null) {
    candidatesSearchRef.current = createDebouncedSearch({
      debounceMs: SEARCH_DEBOUNCE_MS,
      onInvalidate: () => {
        candidatesSessionRef.current.invalidatePendingSearch();
        setExistingEmployeeId("");
      },
      onCommit: (committed) => {
        void reloadCandidatesWithQueryRef.current(committed);
      },
    });
  }

  useEffect(() => {
    const directory = directorySessionRef.current;
    const candidates = candidatesSessionRef.current;
    const directorySearch = directorySearchRef.current;
    const candidatesSearch = candidatesSearchRef.current;
    return () => {
      directorySearch?.dispose();
      candidatesSearch?.dispose();
      directory.dispose();
      candidates.dispose();
    };
  }, []);

  const refreshInvites = useCallback(async () => {
    if (!canInvite) return;
    try {
      const data = await fetchInvitations();
      setInvites(data);
    } catch (err) {
      setBannerError(
        err instanceof Error
          ? err.message
          : t(locale, "Неуспешно зареждане на поканите", "Failed to load invitations"),
      );
      throw err;
    }
  }, [canInvite, locale]);

  const reloadDirectory = useCallback(async () => {
    await reloadDirectoryWithQuery(
      directorySearchRef.current?.getCommitted() ?? "",
    );
  }, [reloadDirectoryWithQuery]);

  const reloadCandidates = useCallback(async () => {
    await reloadCandidatesWithQuery(
      candidatesSearchRef.current?.getCommitted() ?? "",
    );
  }, [reloadCandidatesWithQuery]);

  // Role/checkbox filters reload immediately with the committed search query.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await reloadDirectoryWithQuery(
        directorySearchRef.current?.getCommitted() ?? "",
      );
      if (cancelled) return;
      if (canInvite) {
        try {
          await refreshInvites();
        } catch {
          // refreshInvites already set banner
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    role,
    includeInactive,
    includeArchived,
    notOnboarded,
    reloadDirectoryWithQuery,
    canInvite,
    refreshInvites,
  ]);

  // Independent Existing candidates when Onboarding / Existing is open.
  useEffect(() => {
    if (tab !== "onboarding" || !canInvite || inviteKind !== "existing") return;
    void reloadCandidatesWithQuery(
      candidatesSearchRef.current?.getCommitted() ?? "",
    );
  }, [tab, canInvite, inviteKind, reloadCandidatesWithQuery]);

  useEffect(() => {
    if (
      existingEmployeeId &&
      !existingCandidates.some((p) => p.employeeId === existingEmployeeId)
    ) {
      setExistingEmployeeId("");
    }
  }, [existingCandidates, existingEmployeeId]);

  const displayError =
    bannerError ||
    (tab === "directory" ? directoryState.loadError : null) ||
    (tab === "onboarding" && inviteKind === "existing"
      ? candidatesState.loadError
      : null);

  async function onLoadMoreDirectory() {
    setBannerError(null);
    const query = directorySearchRef.current?.getCommitted() ?? "";
    const filters = directoryFiltersRef.current;
    await runPeopleLoadMore(
      directorySessionRef.current,
      directorySessionRef.current.getState().nextCursor,
      (args) =>
        fetchPeoplePage(
          {
            q: query || undefined,
            role: filters.role || undefined,
            includeInactive: filters.includeInactive,
            includeArchived: filters.includeArchived,
            notOnboarded: filters.notOnboarded || undefined,
            limit: PAGE_SIZE,
            cursor: args.cursor || undefined,
          },
          { signal: args.signal },
        ),
      mapPeopleError,
    );
  }

  async function onLoadMoreCandidates() {
    setBannerError(null);
    const query = candidatesSearchRef.current?.getCommitted() ?? "";
    await runPeopleLoadMore(
      candidatesSessionRef.current,
      candidatesSessionRef.current.getState().nextCursor,
      (args) =>
        fetchPeoplePage(
          {
            q: query || undefined,
            includeInactive: false,
            limit: PAGE_SIZE,
            cursor: args.cursor || undefined,
          },
          { signal: args.signal },
        ),
      (err) =>
        err instanceof Error
          ? err.message
          : t(locale, "Неуспешно зареждане", "Failed to load more"),
    );
  }

  async function onIssue(e: FormEvent) {
    e.preventDefault();
    if (!canInvite || issueInFlight.current) return;
    issueInFlight.current = true;
    setIssuing(true);
    setBannerError(null);
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
          throw new Error(
            t(locale, "Изберете служител", "Select an employee"),
          );
        }
        const needsCreds = selectedExisting && !selectedExisting.userId;
        result = await issueInvitation({
          kind: "existing",
          employeeId: existingEmployeeId,
          ...(needsCreds ? { email: email.trim(), role: inviteRole } : {}),
        });
      }
      setIssued(result);
      setInviteMessage(
        t(
          locale,
          "Поканата е издадена. Копирайте кода и го въведете на екрана Activate device.",
          "Invitation issued. Copy the code and enter it on the Activate device screen.",
        ),
      );
      await Promise.all([
        reloadDirectory().catch(() => undefined),
        refreshInvites().catch(() => undefined),
        inviteKind === "existing"
          ? reloadCandidates().catch(() => undefined)
          : Promise.resolve(),
      ]);
    } catch (err) {
      setBannerError(
        err instanceof Error
          ? err.message
          : t(locale, "Неуспешно издаване на покана", "Failed to issue invitation"),
      );
    } finally {
      setIssuing(false);
      issueInFlight.current = false;
    }
  }

  async function onRevoke(id: string) {
    try {
      setBannerError(null);
      await revokeInvitation(id);
      if (issued?.invitation.id === id) setIssued(null);
      await refreshInvites();
    } catch (err) {
      setBannerError(
        err instanceof Error
          ? err.message
          : t(locale, "Неуспешна отмяна", "Failed to revoke"),
      );
    }
  }

  async function onRefreshDirectoryClick() {
    setBannerError(null);
    const query =
      directorySearchRef.current?.forceCommitFromInput() ?? q.trim();
    await reloadDirectoryWithQuery(query);
  }

  async function onRefreshInvitesClick() {
    setBannerError(null);
    try {
      await refreshInvites();
    } catch {
      // refreshInvites already set banner
    }
  }

  async function runLifecycleAction(
    person: Person,
    action: "block" | "unblock" | "archive" | "restore",
  ) {
    if (lifecycleBusyId) return;
    const status = normalizePersonStatus(person);
    const confirmations: Record<typeof action, string> = {
      block: t(
        locale,
        `Блокиране на ${person.fullName}? Ще се прекратят сесиите и поканите; историята се запазва.`,
        `Block ${person.fullName}? Sessions and invites will end; history is kept.`,
      ),
      unblock: t(
        locale,
        `Отблокиране на ${person.fullName}? Стари сесии, покани и устройства не се възстановяват — нужен е нов вход или нова покана.`,
        `Unblock ${person.fullName}? Old sessions, invites, and devices are not restored — a new login or invite is required.`,
      ),
      archive: t(
        locale,
        `Премахване на ${person.fullName} от екипа? Служителят се архивира и губи достъп; историята се запазва. Незавършената работа трябва да е приключена или прехвърлена предварително.`,
        `Remove ${person.fullName} from the team? The employee is archived and loses access; history is kept. Finish or reassign open work first.`,
      ),
      restore: t(
        locale,
        `Възстановяване на ${person.fullName} в екипа? Достъпът остава спрян — нужни са отблокиране и/или ново активиране.`,
        `Restore ${person.fullName} to the team? Access stays stopped — unblock and/or a new activation are still required.`,
      ),
    };
    if (!window.confirm(confirmations[action])) return;

    setLifecycleBusyId(person.employeeId);
    setBannerError(null);
    try {
      const fn =
        action === "block"
          ? blockPerson
          : action === "unblock"
            ? unblockPerson
            : action === "archive"
              ? archivePerson
              : restorePerson;
      const updated = await fn(
        person.employeeId,
        status,
        person.accessVersion ?? 0,
      );
      setDetailPerson((prev) =>
        prev?.employeeId === updated.employeeId ? updated : prev,
      );
      await reloadDirectoryWithQuery(
        directorySearchRef.current?.getCommitted() ?? "",
      );
    } catch (err) {
      const stale =
        err instanceof ApiRequestError && err.code === "stale_state";
      setBannerError(
        stale
          ? t(
              locale,
              "Състоянието е променено от друг потребител. Списъкът е обновен — прегледайте и опитайте отново.",
              "Status was changed by someone else. The list was refreshed — review and try again.",
            )
          : err instanceof Error
            ? err.message
            : t(locale, "Неуспешна операция", "Operation failed"),
      );
      // Always refresh on conflict so the UI does not keep a stale decision token.
      await reloadDirectoryWithQuery(
        directorySearchRef.current?.getCommitted() ?? "",
      );
    } finally {
      setLifecycleBusyId(null);
    }
  }

  const people = directoryState.people;
  const peopleCursor = directoryState.nextCursor;
  const loading = directoryState.loading && !directoryLoadedOnce;
  const refreshing = directoryState.loading && directoryLoadedOnce;
  const loadingMore = directoryState.loadingMore;
  const directorySearchPending = directorySessionRef.current.isSearchPending();
  const candidatesSearchPending = candidatesSessionRef.current.isSearchPending();
  const loadMoreBlocked =
    loading ||
    refreshing ||
    loadingMore ||
    directorySearchPending ||
    directorySessionRef.current.isFullReloadInFlight();
  const candidatesLoadMoreBlocked =
    candidatesState.loading ||
    candidatesState.loadingMore ||
    candidatesSearchPending ||
    candidatesSessionRef.current.isFullReloadInFlight();
  const issueExistingDisabled =
    issuing ||
    candidatesSearchPending ||
    candidatesState.loading ||
    !existingEmployeeId;

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
      {inviteMessage && tab === "onboarding" && (
        <div className="ok banner">{inviteMessage}</div>
      )}

      {tab === "directory" && (
        <>
          <div className="toolbar">
            <label>
              {t(locale, "Търсене", "Search")}
              <input
                value={q}
                onChange={(e) => {
                  const next = e.target.value;
                  setQ(next);
                  directorySearchRef.current?.onInput(next);
                }}
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
                onChange={(e) => setRole(e.target.value as "" | Role)}
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
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              {t(locale, "Покажи блокирани", "Show blocked")}
            </label>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              {t(locale, "Покажи архивирани", "Show archived")}
            </label>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={notOnboarded}
                onChange={(e) => setNotOnboarded(e.target.checked)}
              />
              {t(locale, "Само без onboarding", "Only not onboarded")}
            </label>
            <button
              type="button"
              className="ghost"
              onClick={() => void onRefreshDirectoryClick()}
              disabled={directoryState.loading}
            >
              {directoryState.loading
                ? t(locale, "Опресняване…", "Refreshing…")
                : t(locale, "Опресни", "Refresh")}
            </button>
          </div>

          {loading ? (
            <p className="muted">
              {t(locale, "Зареждане на хора…", "Loading people…")}
            </p>
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
                                onClick={() => setDevicesPerson(person)}
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
                                    onClick={() => setDetailPerson(person)}
                                  >
                                    {t(locale, "Преглед", "View")}
                                  </button>
                                )}
                                {actions.includes("devices") && (
                                  <button
                                    type="button"
                                    className="ghost"
                                    disabled={busy}
                                    onClick={() => setDevicesPerson(person)}
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
                                      void runLifecycleAction(person, "block")
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
                                      void runLifecycleAction(person, "unblock")
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
                                      void runLifecycleAction(person, "archive")
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
                                      void runLifecycleAction(person, "restore")
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
                    {loadingMore
                      ? t(locale, "Зареждане…", "Loading…")
                      : t(locale, "Още", "Load more")}
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
      )}

      {tab === "onboarding" && canInvite && (
        <div className="control-grid">
          <section className="panel">
            <div className="panel-header">
              <h2>{t(locale, "Издаване на покана", "Issue invitation")}</h2>
            </div>
            <form className="stack" onSubmit={onIssue}>
              <div className="segmented" role="tablist">
                <button
                  type="button"
                  className={inviteKind === "new" ? "active" : ""}
                  onClick={() => setInviteKind("new")}
                >
                  {t(locale, "Нов", "New")}
                </button>
                <button
                  type="button"
                  className={inviteKind === "existing" ? "active" : ""}
                  onClick={() => setInviteKind("existing")}
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
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    {t(locale, "Служебен номер", "Employee number")}
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
                    {t(locale, "Роля", "Role")}
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
                  <label>
                    {t(locale, "Отдел", "Department")}
                    <input
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    {t(locale, "Търсене на служител", "Search employee")}
                    <input
                      value={candidateQ}
                      onChange={(e) => {
                        const next = e.target.value;
                        setCandidateQ(next);
                        candidatesSearchRef.current?.onInput(next);
                      }}
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
                      onChange={(e) => setExistingEmployeeId(e.target.value)}
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
                      {candidatesState.loadingMore
                        ? t(locale, "Зареждане…", "Loading…")
                        : t(locale, "Още кандидати", "Load more candidates")}
                    </button>
                  )}
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
                        {t(locale, "Роля", "Role")}
                        <select
                          value={inviteRole}
                          onChange={(e) =>
                            setInviteRole(e.target.value as Role)
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
            void reloadDirectoryWithQuery(
              directorySearchRef.current?.getCommitted() ?? "",
            );
          }}
          onRevokedOwnDevice={() => {
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
