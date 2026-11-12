// Import module dependency from react.
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  ALL_ROLES,
  // Support the surrounding logic for this step.
  fetchInvitations,
  // Support the surrounding logic for this step.
  fetchPeoplePage,
  // Support the surrounding logic for this step.
  issueInvitation,
  // Support the surrounding logic for this step.
  revokeInvitation,
  // Declare type alias AuthUser.
  type AuthUser,
  // Declare type alias Invitation.
  type Invitation,
  // Declare type alias IssuedInvitation.
  type IssuedInvitation,
  // Declare type alias Person.
  type Person,
  // Declare type alias Role.
  type Role,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ./debouncedSearch.
import { createDebouncedSearch, type DebouncedSearchBridge } from "./debouncedSearch";
// Import module dependency from ./labels.
import { t } from "./labels";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  createPeopleListSession,
  // Support the surrounding logic for this step.
  runPeopleFullReload,
  // Support the surrounding logic for this step.
  runPeopleLoadMore,
  // Declare type alias PeopleListViewState.
  type PeopleListViewState,
// Support the surrounding logic for this step.
} from "./peopleListSession";
// Import module dependency from ./teamListConstants.
import { TEAM_PAGE_SIZE, TEAM_SEARCH_DEBOUNCE_MS } from "./teamListConstants";

// Export type definition for consumers of this module.
export type UseTeamOnboardingOptions = {
  // Provide user field used by this structure.
  user: AuthUser;
  // Provide locale field used by this structure.
  locale: "bg" | "en";
  // Provide canInvite field used by this structure.
  canInvite: boolean;
  // Provide tab field used by this structure.
  tab: "directory" | "onboarding";
  // Provide setBannerError field used by this structure.
  setBannerError: (message: string | null) => void;
  // Provide reloadDirectory field used by this structure.
  reloadDirectory: () => Promise<void>;
};

// Export type definition for consumers of this module.
export type UseTeamOnboardingResult = {
  // Provide invites field used by this structure.
  invites: Invitation[];
  // Provide inviteKind field used by this structure.
  inviteKind: "new" | "existing";
  // Provide setInviteKind field used by this structure.
  setInviteKind: (kind: "new" | "existing") => void;
  // Provide fullName field used by this structure.
  fullName: string;
  // Provide setFullName field used by this structure.
  setFullName: (value: string) => void;
  // Provide employeeNumber field used by this structure.
  employeeNumber: string;
  // Provide setEmployeeNumber field used by this structure.
  setEmployeeNumber: (value: string) => void;
  // Provide email field used by this structure.
  email: string;
  // Provide setEmail field used by this structure.
  setEmail: (value: string) => void;
  // Provide inviteRole field used by this structure.
  inviteRole: Role;
  // Provide setInviteRole field used by this structure.
  setInviteRole: (role: Role) => void;
  // Provide department field used by this structure.
  department: string;
  // Provide setDepartment field used by this structure.
  setDepartment: (value: string) => void;
  // Provide existingEmployeeId field used by this structure.
  existingEmployeeId: string;
  // Provide setExistingEmployeeId field used by this structure.
  setExistingEmployeeId: (value: string) => void;
  // Provide candidateQ field used by this structure.
  candidateQ: string;
  // Provide onCandidateSearchInput field used by this structure.
  onCandidateSearchInput: (value: string) => void;
  // Provide candidatesState field used by this structure.
  candidatesState: PeopleListViewState;
  // Provide candidatesLoadError field used by this structure.
  candidatesLoadError: string | null;
  // Provide existingCandidates field used by this structure.
  existingCandidates: Person[];
  // Provide selectedExisting field used by this structure.
  selectedExisting: Person | undefined;
  // Provide inviteableRoles field used by this structure.
  inviteableRoles: Role[];
  // Provide issuing field used by this structure.
  issuing: boolean;
  // Provide issued field used by this structure.
  issued: IssuedInvitation | null;
  // Provide inviteMessage field used by this structure.
  inviteMessage: string | null;
  // Provide candidatesSearchPending field used by this structure.
  candidatesSearchPending: boolean;
  // Provide candidatesLoadMoreBlocked field used by this structure.
  candidatesLoadMoreBlocked: boolean;
  // Provide issueExistingDisabled field used by this structure.
  issueExistingDisabled: boolean;
  // Provide onIssue field used by this structure.
  onIssue: (e: FormEvent) => Promise<void>;
  // Provide onRevoke field used by this structure.
  onRevoke: (id: string) => Promise<void>;
  // Provide onRefreshInvitesClick field used by this structure.
  onRefreshInvitesClick: () => Promise<void>;
  // Provide onLoadMoreCandidates field used by this structure.
  onLoadMoreCandidates: () => Promise<void>;
  // Provide refreshInvites field used by this structure.
  refreshInvites: () => Promise<void>;
};

// Export function useTeamOnboarding as part of this module's API.
export function useTeamOnboarding({
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
  // Support the surrounding logic for this step.
  reloadDirectory,
// Support the surrounding logic for this step.
}: UseTeamOnboardingOptions): UseTeamOnboardingResult {
  // Hold a mutable ref that persists across renders without re-render.
  const issueInFlight = useRef(false);

  // React state slot for local UI/data that can change over time.
  const [invites, setInvites] = useState<Invitation[]>([]);
  // React state slot for local UI/data that can change over time.
  const [inviteKind, setInviteKind] = useState<"new" | "existing">("new");
  // React state slot for local UI/data that can change over time.
  const [fullName, setFullName] = useState("");
  // React state slot for local UI/data that can change over time.
  const [employeeNumber, setEmployeeNumber] = useState("");
  // React state slot for local UI/data that can change over time.
  const [email, setEmail] = useState("");
  // React state slot for local UI/data that can change over time.
  const [inviteRole, setInviteRole] = useState<Role>("housekeeper");
  // React state slot for local UI/data that can change over time.
  const [department, setDepartment] = useState("");
  // React state slot for local UI/data that can change over time.
  const [existingEmployeeId, setExistingEmployeeId] = useState("");
  // React state slot for local UI/data that can change over time.
  const [candidateQ, setCandidateQ] = useState("");
  // React state slot for local UI/data that can change over time.
  const [candidatesState, setCandidatesState] = useState<PeopleListViewState>({
    // Provide people field used by this structure.
    people: [],
    // Provide nextCursor field used by this structure.
    nextCursor: null,
    // Provide loadError field used by this structure.
    loadError: null,
    // Provide loading field used by this structure.
    loading: false,
    // Provide loadingMore field used by this structure.
    loadingMore: false,
  });
  // Hold a mutable ref that persists across renders without re-render.
  const candidatesSessionRef = useRef(
    // Invoke createPeopleListSession to perform this step.
    createPeopleListSession((next) => setCandidatesState({ ...next })),
  );
  // React state slot for local UI/data that can change over time.
  const [issuing, setIssuing] = useState(false);
  // React state slot for local UI/data that can change over time.
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  // React state slot for local UI/data that can change over time.
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  // Memoize derived value to avoid recomputing every render.
  const inviteableRoles = useMemo(() => {
    // Conditional branch for the case described by this guard.
    if (user.role === "owner") return ALL_ROLES;
    // Return early result or rendered output from this path.
    return ALL_ROLES.filter((r) => r !== "owner" && r !== "admin");
  // Support the surrounding logic for this step.
  }, [user.role]);

  // Memoize derived value to avoid recomputing every render.
  const existingCandidates = useMemo(
    // Support the surrounding logic for this step.
    () =>
      // Invoke candidatesState.people.filter to perform this step.
      candidatesState.people.filter((p) => {
        // Conditional branch for the case described by this guard.
        if (!p.isActive) return false;
        // Conditional branch for the case described by this guard.
        if (p.role && !inviteableRoles.includes(p.role)) return false;
        // Return early result or rendered output from this path.
        return true;
      }),
    // Support the surrounding logic for this step.
    [candidatesState.people, inviteableRoles],
  );

  // Find the first matching item for this lookup.
  const selectedExisting = existingCandidates.find(
    // Support the surrounding logic for this step.
    (p) => p.employeeId === existingEmployeeId,
  );

  // Memoize callback identity for stable child/effect deps.
  const mapCandidatesError = useCallback(
    // Support the surrounding logic for this step.
    (err: unknown) =>
      // Support the surrounding logic for this step.
      err instanceof Error
        // Support the surrounding logic for this step.
        ? err.message
        // Support the surrounding logic for this step.
        : t(
            // Support the surrounding logic for this step.
            locale,
            // Support the surrounding logic for this step.
            "Неуспешно зареждане на кандидати",
            // Support the surrounding logic for this step.
            "Failed to load invite candidates",
          ),
    // Support the surrounding logic for this step.
    [locale],
  );

  // Memoize callback identity for stable child/effect deps.
  const reloadCandidatesWithQuery = useCallback(
    // Support the surrounding logic for this step.
    async (query: string) => {
      // Conditional branch for the case described by this guard.
      if (!canInvite) return;
      // Update React state so the UI reflects the new value.
      setBannerError(null);
      // Wait for an async operation before continuing.
      await runPeopleFullReload(
        // Support the surrounding logic for this step.
        candidatesSessionRef.current,
        // Support the surrounding logic for this step.
        (args) =>
          // Invoke fetchPeoplePage to perform this step.
          fetchPeoplePage(
            {
              // Provide q field used by this structure.
              q: query || undefined,
              // Provide includeInactive field used by this structure.
              includeInactive: false,
              // Provide limit field used by this structure.
              limit: TEAM_PAGE_SIZE,
            },
            // Support the surrounding logic for this step.
            { signal: args.signal },
          ),
        // Support the surrounding logic for this step.
        mapCandidatesError,
      );
    },
    // Support the surrounding logic for this step.
    [canInvite, mapCandidatesError, setBannerError],
  );

  // Hold a mutable ref that persists across renders without re-render.
  const reloadCandidatesWithQueryRef = useRef(reloadCandidatesWithQuery);
  // Support the surrounding logic for this step.
  reloadCandidatesWithQueryRef.current = reloadCandidatesWithQuery;

  // Bind candidatesSearchRef for use in the following logic.
  const candidatesSearchRef = useRef<DebouncedSearchBridge | null>(null);
  // Conditional branch for the case described by this guard.
  if (candidatesSearchRef.current === null) {
    // Support the surrounding logic for this step.
    candidatesSearchRef.current = createDebouncedSearch({
      // Provide debounceMs field used by this structure.
      debounceMs: TEAM_SEARCH_DEBOUNCE_MS,
      // Provide onInvalidate field used by this structure.
      onInvalidate: () => {
        // Invoke candidatesSessionRef.current.invalidatePendingSearch to perform this step.
        candidatesSessionRef.current.invalidatePendingSearch();
        // Update React state so the UI reflects the new value.
        setExistingEmployeeId("");
      },
      // Provide onCommit field used by this structure.
      onCommit: (committed) => {
        // Fire-and-forget async work without awaiting in this path.
        void reloadCandidatesWithQueryRef.current(committed);
      },
    });
  }

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Bind candidates for use in the following logic.
    const candidates = candidatesSessionRef.current;
    // Bind candidatesSearch for use in the following logic.
    const candidatesSearch = candidatesSearchRef.current;
    // Return early result or rendered output from this path.
    return () => {
      // Support the surrounding logic for this step.
      candidatesSearch?.dispose();
      // Invoke candidates.dispose to perform this step.
      candidates.dispose();
    };
  // Support the surrounding logic for this step.
  }, []);

  // Memoize callback identity for stable child/effect deps.
  const reloadCandidates = useCallback(async () => {
    // Wait for an async operation before continuing.
    await reloadCandidatesWithQuery(
      // Support the surrounding logic for this step.
      candidatesSearchRef.current?.getCommitted() ?? "",
    );
  // Support the surrounding logic for this step.
  }, [reloadCandidatesWithQuery]);

  // Memoize callback identity for stable child/effect deps.
  const refreshInvites = useCallback(async () => {
    // Conditional branch for the case described by this guard.
    if (!canInvite) return;
    // Begin guarded block to catch runtime failures.
    try {
      // Bind data for use in the following logic.
      const data = await fetchInvitations();
      // Update React state so the UI reflects the new value.
      setInvites(data);
    // Support the surrounding logic for this step.
    } catch (err) {
      // Update React state so the UI reflects the new value.
      setBannerError(
        // Support the surrounding logic for this step.
        err instanceof Error
          // Support the surrounding logic for this step.
          ? err.message
          // Support the surrounding logic for this step.
          : t(locale, "Неуспешно зареждане на поканите", "Failed to load invitations"),
      );
      // Abort this path by throwing an error to callers.
      throw err;
    }
  // Support the surrounding logic for this step.
  }, [canInvite, locale, setBannerError]);

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Conditional branch for the case described by this guard.
    if (tab !== "onboarding" || !canInvite || inviteKind !== "existing") return;
    // Fire-and-forget async work without awaiting in this path.
    void reloadCandidatesWithQuery(
      // Support the surrounding logic for this step.
      candidatesSearchRef.current?.getCommitted() ?? "",
    );
  // Support the surrounding logic for this step.
  }, [tab, canInvite, inviteKind, reloadCandidatesWithQuery]);

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Conditional branch for the case described by this guard.
    if (
      // Support the surrounding logic for this step.
      existingEmployeeId &&
      // Support the surrounding logic for this step.
      !existingCandidates.some((p) => p.employeeId === existingEmployeeId)
    // Support the surrounding logic for this step.
    ) {
      // Update React state so the UI reflects the new value.
      setExistingEmployeeId("");
    }
  // Support the surrounding logic for this step.
  }, [existingCandidates, existingEmployeeId]);

  // Memoize callback identity for stable child/effect deps.
  const onLoadMoreCandidates = useCallback(async () => {
    // Update React state so the UI reflects the new value.
    setBannerError(null);
    // Bind query for use in the following logic.
    const query = candidatesSearchRef.current?.getCommitted() ?? "";
    // Wait for an async operation before continuing.
    await runPeopleLoadMore(
      // Support the surrounding logic for this step.
      candidatesSessionRef.current,
      // Invoke candidatesSessionRef.current.getState to perform this step.
      candidatesSessionRef.current.getState().nextCursor,
      // Support the surrounding logic for this step.
      (args) =>
        // Invoke fetchPeoplePage to perform this step.
        fetchPeoplePage(
          {
            // Provide q field used by this structure.
            q: query || undefined,
            // Provide includeInactive field used by this structure.
            includeInactive: false,
            // Provide limit field used by this structure.
            limit: TEAM_PAGE_SIZE,
            // Provide cursor field used by this structure.
            cursor: args.cursor || undefined,
          },
          // Support the surrounding logic for this step.
          { signal: args.signal },
        ),
      // Support the surrounding logic for this step.
      (err) =>
        // Support the surrounding logic for this step.
        err instanceof Error
          // Support the surrounding logic for this step.
          ? err.message
          // Support the surrounding logic for this step.
          : t(locale, "Неуспешно зареждане", "Failed to load more"),
    );
  // Support the surrounding logic for this step.
  }, [locale, setBannerError]);

  // Memoize callback identity for stable child/effect deps.
  const onIssue = useCallback(
    // Support the surrounding logic for this step.
    async (e: FormEvent) => {
      // Invoke e.preventDefault to perform this step.
      e.preventDefault();
      // Conditional branch for the case described by this guard.
      if (!canInvite || issueInFlight.current) return;
      // Support the surrounding logic for this step.
      issueInFlight.current = true;
      // Update React state so the UI reflects the new value.
      setIssuing(true);
      // Update React state so the UI reflects the new value.
      setBannerError(null);
      // Update React state so the UI reflects the new value.
      setInviteMessage(null);
      // Update React state so the UI reflects the new value.
      setIssued(null);
      // Begin guarded block to catch runtime failures.
      try {
        // Bind result for use in the following logic.
        let result: IssuedInvitation;
        // Conditional branch for the case described by this guard.
        if (inviteKind === "new") {
          // Support the surrounding logic for this step.
          result = await issueInvitation({
            // Provide kind field used by this structure.
            kind: "new",
            // Provide fullName field used by this structure.
            fullName: fullName.trim(),
            // Provide employeeNumber field used by this structure.
            employeeNumber: employeeNumber.trim(),
            // Provide email field used by this structure.
            email: email.trim(),
            // Provide role field used by this structure.
            role: inviteRole,
            // Provide department field used by this structure.
            department: department.trim() || null,
          });
        // Support the surrounding logic for this step.
        } else {
          // Conditional branch for the case described by this guard.
          if (!existingEmployeeId) {
            // Abort this path by throwing an error to callers.
            throw new Error(
              // Invoke t to perform this step.
              t(locale, "Изберете служител", "Select an employee"),
            );
          }
          // Bind needsCreds for use in the following logic.
          const needsCreds = selectedExisting && !selectedExisting.userId;
          // Support the surrounding logic for this step.
          result = await issueInvitation({
            // Provide kind field used by this structure.
            kind: "existing",
            // Provide employeeId field used by this structure.
            employeeId: existingEmployeeId,
            // Spread prior fields/items so overrides can layer cleanly.
            ...(needsCreds ? { email: email.trim(), role: inviteRole } : {}),
          });
        }
        // Update React state so the UI reflects the new value.
        setIssued(result);
        // Update React state so the UI reflects the new value.
        setInviteMessage(
          // Invoke t to perform this step.
          t(
            // Support the surrounding logic for this step.
            locale,
            // Support the surrounding logic for this step.
            "Поканата е издадена. Копирайте кода и го въведете на екрана Activate device.",
            // Support the surrounding logic for this step.
            "Invitation issued. Copy the code and enter it on the Activate device screen.",
          ),
        );
        // Wait for an async operation before continuing.
        await Promise.all([
          // Invoke reloadDirectory to perform this step.
          reloadDirectory().catch(() => undefined),
          // Invoke refreshInvites to perform this step.
          refreshInvites().catch(() => undefined),
          // Support the surrounding logic for this step.
          inviteKind === "existing"
            // Support the surrounding logic for this step.
            ? reloadCandidates().catch(() => undefined)
            // Support the surrounding logic for this step.
            : Promise.resolve(),
        // Support the surrounding logic for this step.
        ]);
      // Support the surrounding logic for this step.
      } catch (err) {
        // Update React state so the UI reflects the new value.
        setBannerError(
          // Support the surrounding logic for this step.
          err instanceof Error
            // Support the surrounding logic for this step.
            ? err.message
            // Support the surrounding logic for this step.
            : t(locale, "Неуспешно издаване на покана", "Failed to issue invitation"),
        );
      // Support the surrounding logic for this step.
      } finally {
        // Update React state so the UI reflects the new value.
        setIssuing(false);
        // Support the surrounding logic for this step.
        issueInFlight.current = false;
      }
    },
    [
      // Support the surrounding logic for this step.
      canInvite,
      // Support the surrounding logic for this step.
      inviteKind,
      // Support the surrounding logic for this step.
      fullName,
      // Support the surrounding logic for this step.
      employeeNumber,
      // Support the surrounding logic for this step.
      email,
      // Support the surrounding logic for this step.
      inviteRole,
      // Support the surrounding logic for this step.
      department,
      // Support the surrounding logic for this step.
      existingEmployeeId,
      // Support the surrounding logic for this step.
      selectedExisting,
      // Support the surrounding logic for this step.
      locale,
      // Support the surrounding logic for this step.
      setBannerError,
      // Support the surrounding logic for this step.
      reloadDirectory,
      // Support the surrounding logic for this step.
      refreshInvites,
      // Support the surrounding logic for this step.
      reloadCandidates,
    ],
  );

  // Memoize callback identity for stable child/effect deps.
  const onRevoke = useCallback(
    // Support the surrounding logic for this step.
    async (id: string) => {
      // Begin guarded block to catch runtime failures.
      try {
        // Update React state so the UI reflects the new value.
        setBannerError(null);
        // Wait for an async operation before continuing.
        await revokeInvitation(id);
        // Conditional branch for the case described by this guard.
        if (issued?.invitation.id === id) setIssued(null);
        // Wait for an async operation before continuing.
        await refreshInvites();
      // Support the surrounding logic for this step.
      } catch (err) {
        // Update React state so the UI reflects the new value.
        setBannerError(
          // Support the surrounding logic for this step.
          err instanceof Error
            // Support the surrounding logic for this step.
            ? err.message
            // Support the surrounding logic for this step.
            : t(locale, "Неуспешна отмяна", "Failed to revoke"),
        );
      }
    },
    // Support the surrounding logic for this step.
    [issued, locale, refreshInvites, setBannerError],
  );

  // Memoize callback identity for stable child/effect deps.
  const onRefreshInvitesClick = useCallback(async () => {
    // Update React state so the UI reflects the new value.
    setBannerError(null);
    // Begin guarded block to catch runtime failures.
    try {
      // Wait for an async operation before continuing.
      await refreshInvites();
    // Support the surrounding logic for this step.
    } catch {
      // refreshInvites already set banner
    }
  // Support the surrounding logic for this step.
  }, [refreshInvites, setBannerError]);

  // Memoize callback identity for stable child/effect deps.
  const onCandidateSearchInput = useCallback((value: string) => {
    // Update React state so the UI reflects the new value.
    setCandidateQ(value);
    // Support the surrounding logic for this step.
    candidatesSearchRef.current?.onInput(value);
  // Support the surrounding logic for this step.
  }, []);

  // Bind candidatesSearchPending for use in the following logic.
  const candidatesSearchPending =
    // Invoke candidatesSessionRef.current.isSearchPending to perform this step.
    candidatesSessionRef.current.isSearchPending();
  // Bind candidatesLoadMoreBlocked for use in the following logic.
  const candidatesLoadMoreBlocked =
    // Support the surrounding logic for this step.
    candidatesState.loading ||
    // Support the surrounding logic for this step.
    candidatesState.loadingMore ||
    // Support the surrounding logic for this step.
    candidatesSearchPending ||
    // Invoke candidatesSessionRef.current.isFullReloadInFlight to perform this step.
    candidatesSessionRef.current.isFullReloadInFlight();
  // Bind issueExistingDisabled for use in the following logic.
  const issueExistingDisabled =
    // Support the surrounding logic for this step.
    issuing ||
    // Support the surrounding logic for this step.
    candidatesSearchPending ||
    // Support the surrounding logic for this step.
    candidatesState.loading ||
    // Support the surrounding logic for this step.
    !existingEmployeeId;

  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    invites,
    // Support the surrounding logic for this step.
    inviteKind,
    // Support the surrounding logic for this step.
    setInviteKind,
    // Support the surrounding logic for this step.
    fullName,
    // Support the surrounding logic for this step.
    setFullName,
    // Support the surrounding logic for this step.
    employeeNumber,
    // Support the surrounding logic for this step.
    setEmployeeNumber,
    // Support the surrounding logic for this step.
    email,
    // Support the surrounding logic for this step.
    setEmail,
    // Support the surrounding logic for this step.
    inviteRole,
    // Support the surrounding logic for this step.
    setInviteRole,
    // Support the surrounding logic for this step.
    department,
    // Support the surrounding logic for this step.
    setDepartment,
    // Support the surrounding logic for this step.
    existingEmployeeId,
    // Support the surrounding logic for this step.
    setExistingEmployeeId,
    // Support the surrounding logic for this step.
    candidateQ,
    // Support the surrounding logic for this step.
    onCandidateSearchInput,
    // Support the surrounding logic for this step.
    candidatesState,
    // Provide candidatesLoadError field used by this structure.
    candidatesLoadError: candidatesState.loadError,
    // Support the surrounding logic for this step.
    existingCandidates,
    // Support the surrounding logic for this step.
    selectedExisting,
    // Support the surrounding logic for this step.
    inviteableRoles,
    // Support the surrounding logic for this step.
    issuing,
    // Support the surrounding logic for this step.
    issued,
    // Support the surrounding logic for this step.
    inviteMessage,
    // Support the surrounding logic for this step.
    candidatesSearchPending,
    // Support the surrounding logic for this step.
    candidatesLoadMoreBlocked,
    // Support the surrounding logic for this step.
    issueExistingDisabled,
    // Support the surrounding logic for this step.
    onIssue,
    // Support the surrounding logic for this step.
    onRevoke,
    // Support the surrounding logic for this step.
    onRefreshInvitesClick,
    // Support the surrounding logic for this step.
    onLoadMoreCandidates,
    // Support the surrounding logic for this step.
    refreshInvites,
  };
}
