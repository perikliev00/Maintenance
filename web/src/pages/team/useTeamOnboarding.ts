import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_ROLES,
  fetchInvitations,
  fetchPeoplePage,
  issueInvitation,
  revokeInvitation,
  type AuthUser,
  type Invitation,
  type IssuedInvitation,
  type Person,
  type Role,
} from "../../api/client";
import { createDebouncedSearch, type DebouncedSearchBridge } from "./debouncedSearch";
import { t } from "./labels";
import {
  createPeopleListSession,
  runPeopleFullReload,
  runPeopleLoadMore,
  type PeopleListViewState,
} from "./peopleListSession";
import { TEAM_PAGE_SIZE, TEAM_SEARCH_DEBOUNCE_MS } from "./teamListConstants";

export type UseTeamOnboardingOptions = {
  user: AuthUser;
  locale: "bg" | "en";
  canInvite: boolean;
  tab: "directory" | "onboarding";
  setBannerError: (message: string | null) => void;
  reloadDirectory: () => Promise<void>;
};

export type UseTeamOnboardingResult = {
  invites: Invitation[];
  inviteKind: "new" | "existing";
  setInviteKind: (kind: "new" | "existing") => void;
  fullName: string;
  setFullName: (value: string) => void;
  employeeNumber: string;
  setEmployeeNumber: (value: string) => void;
  email: string;
  setEmail: (value: string) => void;
  inviteRole: Role;
  setInviteRole: (role: Role) => void;
  department: string;
  setDepartment: (value: string) => void;
  existingEmployeeId: string;
  setExistingEmployeeId: (value: string) => void;
  candidateQ: string;
  onCandidateSearchInput: (value: string) => void;
  candidatesState: PeopleListViewState;
  candidatesLoadError: string | null;
  existingCandidates: Person[];
  selectedExisting: Person | undefined;
  inviteableRoles: Role[];
  issuing: boolean;
  issued: IssuedInvitation | null;
  inviteMessage: string | null;
  candidatesSearchPending: boolean;
  candidatesLoadMoreBlocked: boolean;
  issueExistingDisabled: boolean;
  onIssue: (e: FormEvent) => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
  onRefreshInvitesClick: () => Promise<void>;
  onLoadMoreCandidates: () => Promise<void>;
  refreshInvites: () => Promise<void>;
};

export function useTeamOnboarding({
  user,
  locale,
  canInvite,
  tab,
  setBannerError,
  reloadDirectory,
}: UseTeamOnboardingOptions): UseTeamOnboardingResult {
  const issueInFlight = useRef(false);

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
              limit: TEAM_PAGE_SIZE,
            },
            { signal: args.signal },
          ),
        mapCandidatesError,
      );
    },
    [canInvite, mapCandidatesError, setBannerError],
  );

  const reloadCandidatesWithQueryRef = useRef(reloadCandidatesWithQuery);
  reloadCandidatesWithQueryRef.current = reloadCandidatesWithQuery;

  const candidatesSearchRef = useRef<DebouncedSearchBridge | null>(null);
  if (candidatesSearchRef.current === null) {
    candidatesSearchRef.current = createDebouncedSearch({
      debounceMs: TEAM_SEARCH_DEBOUNCE_MS,
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
    const candidates = candidatesSessionRef.current;
    const candidatesSearch = candidatesSearchRef.current;
    return () => {
      candidatesSearch?.dispose();
      candidates.dispose();
    };
  }, []);

  const reloadCandidates = useCallback(async () => {
    await reloadCandidatesWithQuery(
      candidatesSearchRef.current?.getCommitted() ?? "",
    );
  }, [reloadCandidatesWithQuery]);

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
  }, [canInvite, locale, setBannerError]);

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

  const onLoadMoreCandidates = useCallback(async () => {
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
            limit: TEAM_PAGE_SIZE,
            cursor: args.cursor || undefined,
          },
          { signal: args.signal },
        ),
      (err) =>
        err instanceof Error
          ? err.message
          : t(locale, "Неуспешно зареждане", "Failed to load more"),
    );
  }, [locale, setBannerError]);

  const onIssue = useCallback(
    async (e: FormEvent) => {
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
    },
    [
      canInvite,
      inviteKind,
      fullName,
      employeeNumber,
      email,
      inviteRole,
      department,
      existingEmployeeId,
      selectedExisting,
      locale,
      setBannerError,
      reloadDirectory,
      refreshInvites,
      reloadCandidates,
    ],
  );

  const onRevoke = useCallback(
    async (id: string) => {
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
    },
    [issued, locale, refreshInvites, setBannerError],
  );

  const onRefreshInvitesClick = useCallback(async () => {
    setBannerError(null);
    try {
      await refreshInvites();
    } catch {
      // refreshInvites already set banner
    }
  }, [refreshInvites, setBannerError]);

  const onCandidateSearchInput = useCallback((value: string) => {
    setCandidateQ(value);
    candidatesSearchRef.current?.onInput(value);
  }, []);

  const candidatesSearchPending =
    candidatesSessionRef.current.isSearchPending();
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

  return {
    invites,
    inviteKind,
    setInviteKind,
    fullName,
    setFullName,
    employeeNumber,
    setEmployeeNumber,
    email,
    setEmail,
    inviteRole,
    setInviteRole,
    department,
    setDepartment,
    existingEmployeeId,
    setExistingEmployeeId,
    candidateQ,
    onCandidateSearchInput,
    candidatesState,
    candidatesLoadError: candidatesState.loadError,
    existingCandidates,
    selectedExisting,
    inviteableRoles,
    issuing,
    issued,
    inviteMessage,
    candidatesSearchPending,
    candidatesLoadMoreBlocked,
    issueExistingDisabled,
    onIssue,
    onRevoke,
    onRefreshInvitesClick,
    onLoadMoreCandidates,
    refreshInvites,
  };
}
