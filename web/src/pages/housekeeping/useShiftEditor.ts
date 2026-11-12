// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  FormEvent,
  // Support the surrounding logic for this step.
  MutableRefObject,
  // Support the surrounding logic for this step.
  useCallback,
  // Support the surrounding logic for this step.
  useEffect,
  // Support the surrounding logic for this step.
  useMemo,
  // Support the surrounding logic for this step.
  useRef,
  // Support the surrounding logic for this step.
  useState,
// Support the surrounding logic for this step.
} from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  createShift,
  // Support the surrounding logic for this step.
  fetchShiftRoster,
  // Support the surrounding logic for this step.
  saveShiftRoster,
  // Support the surrounding logic for this step.
  todayHotelDate,
  // Support the surrounding logic for this step.
  updateShift,
  // Declare type alias ShiftRosterEntry.
  type ShiftRosterEntry,
  // Declare type alias ShiftRow.
  type ShiftRow,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import type-only dependency for typing without runtime cost.
import type { BusyMutationResult } from "../../hooks/useBusyMutation";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  canSaveRosterDraft,
  // Support the surrounding logic for this step.
  shouldApplyRosterLoad,
  // Support the surrounding logic for this step.
  shouldApplyRosterSaveResult,
// Support the surrounding logic for this step.
} from "./shiftRosterLoadLogic";

// Export type definition for consumers of this module.
export type ShiftFormMode = "closed" | "create" | "edit";

// Declare type alias RunMutationWithRefresh.
type RunMutationWithRefresh = <T>(
  // Provide mutate field used by this structure.
  mutate: () => Promise<T>,
  // Support the surrounding logic for this step.
  refresh?: () => Promise<void>,
// Support the surrounding logic for this step.
) => Promise<BusyMutationResult<T>>;

// Export type definition for consumers of this module.
export type UseShiftEditorOptions = {
  // Provide tab field used by this structure.
  tab: "catalog" | "sectors" | "shifts";
  // Provide canManageShifts field used by this structure.
  canManageShifts: boolean;
  // Provide refreshShifts field used by this structure.
  refreshShifts: () => Promise<void>;
  // Provide setShiftsError field used by this structure.
  setShiftsError: (err: string | null) => void;
  // Provide setMessage field used by this structure.
  setMessage: (msg: string | null) => void;
  // Provide label field used by this structure.
  label: (bg: string, en: string) => string;
  // Provide busyRef field used by this structure.
  busyRef: MutableRefObject<boolean>;
  // Provide runMutationWithRefresh field used by this structure.
  runMutationWithRefresh: RunMutationWithRefresh;
};

// Export function useShiftEditor as part of this module's API.
export function useShiftEditor(options: UseShiftEditorOptions) {
  // Bind a local value for the following logic.
  const {
    // Support the surrounding logic for this step.
    tab,
    // Support the surrounding logic for this step.
    canManageShifts,
    // Support the surrounding logic for this step.
    refreshShifts,
    // Support the surrounding logic for this step.
    setShiftsError,
    // Support the surrounding logic for this step.
    setMessage,
    // Support the surrounding logic for this step.
    label,
    // Support the surrounding logic for this step.
    busyRef,
    // Support the surrounding logic for this step.
    runMutationWithRefresh,
  // Support the surrounding logic for this step.
  } = options;

  // React state slot for local UI/data that can change over time.
  const [shiftMode, setShiftMode] = useState<ShiftFormMode>("closed");
  // React state slot for local UI/data that can change over time.
  const [editingShift, setEditingShift] = useState<ShiftRow | null>(null);
  // React state slot for local UI/data that can change over time.
  const [shiftCode, setShiftCode] = useState("");
  // React state slot for local UI/data that can change over time.
  const [shiftNameBg, setShiftNameBg] = useState("");
  // React state slot for local UI/data that can change over time.
  const [shiftNameEn, setShiftNameEn] = useState("");
  // React state slot for local UI/data that can change over time.
  const [shiftStart, setShiftStart] = useState("06:00");
  // React state slot for local UI/data that can change over time.
  const [shiftEnd, setShiftEnd] = useState("14:00");
  // React state slot for local UI/data that can change over time.
  const [shiftSort, setShiftSort] = useState(0);
  // React state slot for local UI/data that can change over time.
  const [shiftActive, setShiftActive] = useState(true);
  // React state slot for local UI/data that can change over time.
  const [shiftFormError, setShiftFormError] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [shiftBaseline, setShiftBaseline] = useState("");

  // React state slot for local UI/data that can change over time.
  const [rosterDate, setRosterDateState] = useState(todayHotelDate());
  // React state slot for local UI/data that can change over time.
  const [rosterEntries, setRosterEntries] = useState<ShiftRosterEntry[]>([]);
  // React state slot for local UI/data that can change over time.
  const [rosterDraft, setRosterDraft] = useState<Record<string, string>>({});
  // React state slot for local UI/data that can change over time.
  const [rosterLoadedDate, setRosterLoadedDate] = useState<string | null>(null);
  // Hold a mutable ref that persists across renders without re-render.
  const rosterDateRef = useRef(rosterDate);
  // Support the surrounding logic for this step.
  rosterDateRef.current = rosterDate;
  // Hold a mutable ref that persists across renders without re-render.
  const rosterLoadGen = useRef(0);
  // Hold a mutable ref that persists across renders without re-render.
  const rosterSaveGen = useRef(0);

  // Memoize callback identity for stable child/effect deps.
  const setRosterDate = useCallback((date: string) => {
    // Invalidate in-flight GETs/PUTs for the previous day (incl. A→B→A).
    rosterLoadGen.current += 1;
    // Update React state so the UI reflects the new value.
    setRosterLoadedDate(null);
    // Update React state so the UI reflects the new value.
    setRosterDateState(date);
  // Support the surrounding logic for this step.
  }, []);

  // Memoize callback identity for stable child/effect deps.
  const refreshRoster = useCallback(
    // Support the surrounding logic for this step.
    async (date: string) => {
      // Conditional branch for the case described by this guard.
      if (!canManageShifts) return;
      // Bind requestId for use in the following logic.
      const requestId = ++rosterLoadGen.current;
      // Begin guarded block to catch runtime failures.
      try {
        // Bind roster for use in the following logic.
        const roster = await fetchShiftRoster(date);
        // Conditional branch for the case described by this guard.
        if (
          // Support the surrounding logic for this step.
          !shouldApplyRosterLoad({
            // Provide requestDate field used by this structure.
            requestDate: date,
            // Provide activeDate field used by this structure.
            activeDate: rosterDateRef.current,
            // Support the surrounding logic for this step.
            requestId,
            // Provide latestRequestId field used by this structure.
            latestRequestId: rosterLoadGen.current,
          })
        // Support the surrounding logic for this step.
        ) {
          // Return early result or rendered output from this path.
          return;
        }
        // Update React state so the UI reflects the new value.
        setRosterEntries(roster.entries);
        // Initialize an object holding related fields.
        const draft: Record<string, string> = {};
        // Iterate a collection or counted range.
        for (const e of roster.entries) {
          // Support the surrounding logic for this step.
          draft[e.employee.id] = e.shift.id;
        }
        // Update React state so the UI reflects the new value.
        setRosterDraft(draft);
        // Update React state so the UI reflects the new value.
        setRosterLoadedDate(date);
      // Support the surrounding logic for this step.
      } catch (err) {
        // Conditional branch for the case described by this guard.
        if (
          // Support the surrounding logic for this step.
          !shouldApplyRosterLoad({
            // Provide requestDate field used by this structure.
            requestDate: date,
            // Provide activeDate field used by this structure.
            activeDate: rosterDateRef.current,
            // Support the surrounding logic for this step.
            requestId,
            // Provide latestRequestId field used by this structure.
            latestRequestId: rosterLoadGen.current,
          })
        // Support the surrounding logic for this step.
        ) {
          // Return early result or rendered output from this path.
          return;
        }
        // Update React state so the UI reflects the new value.
        setRosterLoadedDate(null);
        // Abort this path by throwing an error to callers.
        throw err;
      }
    },
    // Support the surrounding logic for this step.
    [canManageShifts],
  );

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Conditional branch for the case described by this guard.
    if (tab !== "shifts" || !canManageShifts) return;
    // Fire-and-forget async work without awaiting in this path.
    void refreshRoster(rosterDate).catch((err) => {
      // Update React state so the UI reflects the new value.
      setShiftsError(
        // Support the surrounding logic for this step.
        err instanceof Error ? err.message : "Failed to load roster",
      );
    });
  // Support the surrounding logic for this step.
  }, [tab, rosterDate, canManageShifts, refreshRoster, setShiftsError]);

  // Memoize derived value to avoid recomputing every render.
  const shiftSnapshot = useMemo(
    // Support the surrounding logic for this step.
    () =>
      // Invoke JSON.stringify to perform this step.
      JSON.stringify({
        // Support the surrounding logic for this step.
        shiftCode,
        // Support the surrounding logic for this step.
        shiftNameBg,
        // Support the surrounding logic for this step.
        shiftNameEn,
        // Support the surrounding logic for this step.
        shiftStart,
        // Support the surrounding logic for this step.
        shiftEnd,
        // Support the surrounding logic for this step.
        shiftSort,
        // Support the surrounding logic for this step.
        shiftActive,
      }),
    [
      // Support the surrounding logic for this step.
      shiftCode,
      // Support the surrounding logic for this step.
      shiftNameBg,
      // Support the surrounding logic for this step.
      shiftNameEn,
      // Support the surrounding logic for this step.
      shiftStart,
      // Support the surrounding logic for this step.
      shiftEnd,
      // Support the surrounding logic for this step.
      shiftSort,
      // Support the surrounding logic for this step.
      shiftActive,
    ],
  );
  // Bind shiftDirty for use in the following logic.
  const shiftDirty =
    // Support the surrounding logic for this step.
    shiftMode !== "closed" && shiftSnapshot !== shiftBaseline;

  // Memoize callback identity for stable child/effect deps.
  const closeShiftForm = useCallback(
    // Support the surrounding logic for this step.
    (opts?: { force?: boolean }) => {
      // Conditional branch for the case described by this guard.
      if (!opts?.force && busyRef.current) return;
      // Update React state so the UI reflects the new value.
      setShiftMode("closed");
      // Update React state so the UI reflects the new value.
      setEditingShift(null);
      // Update React state so the UI reflects the new value.
      setShiftCode("");
      // Update React state so the UI reflects the new value.
      setShiftNameBg("");
      // Update React state so the UI reflects the new value.
      setShiftNameEn("");
      // Update React state so the UI reflects the new value.
      setShiftStart("06:00");
      // Update React state so the UI reflects the new value.
      setShiftEnd("14:00");
      // Update React state so the UI reflects the new value.
      setShiftSort(0);
      // Update React state so the UI reflects the new value.
      setShiftActive(true);
      // Update React state so the UI reflects the new value.
      setShiftFormError(null);
      // Update React state so the UI reflects the new value.
      setShiftBaseline("");
    },
    // Support the surrounding logic for this step.
    [busyRef],
  );

  // Memoize callback identity for stable child/effect deps.
  const startCreateShift = useCallback(() => {
    // Conditional branch for the case described by this guard.
    if (!canManageShifts || busyRef.current) return;
    // Update React state so the UI reflects the new value.
    setShiftMode("create");
    // Update React state so the UI reflects the new value.
    setEditingShift(null);
    // Update React state so the UI reflects the new value.
    setShiftCode("");
    // Update React state so the UI reflects the new value.
    setShiftNameBg("");
    // Update React state so the UI reflects the new value.
    setShiftNameEn("");
    // Update React state so the UI reflects the new value.
    setShiftStart("06:00");
    // Update React state so the UI reflects the new value.
    setShiftEnd("14:00");
    // Update React state so the UI reflects the new value.
    setShiftSort(0);
    // Update React state so the UI reflects the new value.
    setShiftActive(true);
    // Update React state so the UI reflects the new value.
    setMessage(null);
    // Update React state so the UI reflects the new value.
    setShiftFormError(null);
    // Update React state so the UI reflects the new value.
    setShiftBaseline(
      // Invoke JSON.stringify to perform this step.
      JSON.stringify({
        // Provide shiftCode field used by this structure.
        shiftCode: "",
        // Provide shiftNameBg field used by this structure.
        shiftNameBg: "",
        // Provide shiftNameEn field used by this structure.
        shiftNameEn: "",
        // Provide shiftStart field used by this structure.
        shiftStart: "06:00",
        // Provide shiftEnd field used by this structure.
        shiftEnd: "14:00",
        // Provide shiftSort field used by this structure.
        shiftSort: 0,
        // Provide shiftActive field used by this structure.
        shiftActive: true,
      }),
    );
  // Support the surrounding logic for this step.
  }, [canManageShifts, busyRef, setMessage]);

  // Memoize callback identity for stable child/effect deps.
  const startEditShift = useCallback(
    // Support the surrounding logic for this step.
    (shift: ShiftRow) => {
      // Conditional branch for the case described by this guard.
      if (busyRef.current) return;
      // Update React state so the UI reflects the new value.
      setShiftMode("edit");
      // Update React state so the UI reflects the new value.
      setEditingShift(shift);
      // Update React state so the UI reflects the new value.
      setShiftCode(shift.code);
      // Update React state so the UI reflects the new value.
      setShiftNameBg(shift.nameBg);
      // Update React state so the UI reflects the new value.
      setShiftNameEn(shift.nameEn);
      // Update React state so the UI reflects the new value.
      setShiftStart(shift.startTime);
      // Update React state so the UI reflects the new value.
      setShiftEnd(shift.endTime);
      // Update React state so the UI reflects the new value.
      setShiftSort(shift.sortOrder);
      // Update React state so the UI reflects the new value.
      setShiftActive(shift.isActive);
      // Update React state so the UI reflects the new value.
      setMessage(null);
      // Update React state so the UI reflects the new value.
      setShiftFormError(null);
      // Update React state so the UI reflects the new value.
      setShiftBaseline(
        // Invoke JSON.stringify to perform this step.
        JSON.stringify({
          // Provide shiftCode field used by this structure.
          shiftCode: shift.code,
          // Provide shiftNameBg field used by this structure.
          shiftNameBg: shift.nameBg,
          // Provide shiftNameEn field used by this structure.
          shiftNameEn: shift.nameEn,
          // Provide shiftStart field used by this structure.
          shiftStart: shift.startTime,
          // Provide shiftEnd field used by this structure.
          shiftEnd: shift.endTime,
          // Provide shiftSort field used by this structure.
          shiftSort: shift.sortOrder,
          // Provide shiftActive field used by this structure.
          shiftActive: shift.isActive,
        }),
      );
    },
    // Support the surrounding logic for this step.
    [busyRef, setMessage],
  );

  // Memoize callback identity for stable child/effect deps.
  const onSaveShift = useCallback(
    // Support the surrounding logic for this step.
    async (e: FormEvent) => {
      // Invoke e.preventDefault to perform this step.
      e.preventDefault();
      // Conditional branch for the case described by this guard.
      if (!canManageShifts || busyRef.current) return;
      // Update React state so the UI reflects the new value.
      setMessage(null);
      // Update React state so the UI reflects the new value.
      setShiftsError(null);
      // Update React state so the UI reflects the new value.
      setShiftFormError(null);
      // Bind editing for use in the following logic.
      const editing = Boolean(editingShift);

      // Bind result for use in the following logic.
      const result = await runMutationWithRefresh(async () => {
        // Conditional branch for the case described by this guard.
        if (editingShift) {
          // Wait for an async operation before continuing.
          await updateShift(editingShift.id, {
            // Provide code field used by this structure.
            code: shiftCode,
            // Provide nameBg field used by this structure.
            nameBg: shiftNameBg,
            // Provide nameEn field used by this structure.
            nameEn: shiftNameEn,
            // Provide startTime field used by this structure.
            startTime: shiftStart,
            // Provide endTime field used by this structure.
            endTime: shiftEnd,
            // Provide sortOrder field used by this structure.
            sortOrder: shiftSort,
            // Provide isActive field used by this structure.
            isActive: shiftActive,
          });
        // Support the surrounding logic for this step.
        } else {
          // Wait for an async operation before continuing.
          await createShift({
            // Provide code field used by this structure.
            code: shiftCode,
            // Provide nameBg field used by this structure.
            nameBg: shiftNameBg,
            // Provide nameEn field used by this structure.
            nameEn: shiftNameEn,
            // Provide startTime field used by this structure.
            startTime: shiftStart,
            // Provide endTime field used by this structure.
            endTime: shiftEnd,
            // Provide sortOrder field used by this structure.
            sortOrder: shiftSort,
            // Provide isActive field used by this structure.
            isActive: shiftActive,
          });
        }
        // Invoke closeShiftForm to perform this step.
        closeShiftForm({ force: true });
      // Support the surrounding logic for this step.
      }, refreshShifts);

      // Conditional branch for the case described by this guard.
      if (!result.ok) {
        // Conditional branch for the case described by this guard.
        if (result.error !== "busy") {
          // Update React state so the UI reflects the new value.
          setShiftFormError(result.error);
        }
        // Return early result or rendered output from this path.
        return;
      }
      // Conditional branch for the case described by this guard.
      if (result.outcome === "saved_refresh_failed") {
        // Bind detail for use in the following logic.
        const detail = result.refreshError
          // Support the surrounding logic for this step.
          ? `: ${result.refreshError}`
          // Support the surrounding logic for this step.
          : "";
        // Update React state so the UI reflects the new value.
        setShiftsError(
          // Support the surrounding logic for this step.
          `${label(
            // Support the surrounding logic for this step.
            "Записът е успешен, но обновяването се провали",
            // Support the surrounding logic for this step.
            "Saved, but refresh failed",
          // Support the surrounding logic for this step.
          )}${detail}`,
        );
      }
      // Conditional branch for the case described by this guard.
      if (
        // Support the surrounding logic for this step.
        result.outcome === "saved" ||
        // Support the surrounding logic for this step.
        result.outcome === "saved_refresh_failed"
      // Support the surrounding logic for this step.
      ) {
        // Update React state so the UI reflects the new value.
        setMessage(
          // Support the surrounding logic for this step.
          editing
            // Support the surrounding logic for this step.
            ? label("Смяната е обновена", "Shift updated")
            // Support the surrounding logic for this step.
            : label("Смяната е създадена", "Shift created"),
        );
      }
    },
    [
      // Support the surrounding logic for this step.
      canManageShifts,
      // Support the surrounding logic for this step.
      busyRef,
      // Support the surrounding logic for this step.
      runMutationWithRefresh,
      // Support the surrounding logic for this step.
      editingShift,
      // Support the surrounding logic for this step.
      shiftCode,
      // Support the surrounding logic for this step.
      shiftNameBg,
      // Support the surrounding logic for this step.
      shiftNameEn,
      // Support the surrounding logic for this step.
      shiftStart,
      // Support the surrounding logic for this step.
      shiftEnd,
      // Support the surrounding logic for this step.
      shiftSort,
      // Support the surrounding logic for this step.
      shiftActive,
      // Support the surrounding logic for this step.
      closeShiftForm,
      // Support the surrounding logic for this step.
      refreshShifts,
      // Support the surrounding logic for this step.
      setShiftsError,
      // Support the surrounding logic for this step.
      label,
      // Support the surrounding logic for this step.
      setMessage,
    ],
  );

  // Memoize callback identity for stable child/effect deps.
  const onSaveRoster = useCallback(async () => {
    // Conditional branch for the case described by this guard.
    if (
      // Support the surrounding logic for this step.
      !canSaveRosterDraft({
        // Provide activeDate field used by this structure.
        activeDate: rosterDate,
        // Provide loadedDate field used by this structure.
        loadedDate: rosterLoadedDate,
        // Provide busy field used by this structure.
        busy: busyRef.current,
      })
    // Support the surrounding logic for this step.
    ) {
      // Return early result or rendered output from this path.
      return;
    }
    // Update React state so the UI reflects the new value.
    setShiftsError(null);
    // Update React state so the UI reflects the new value.
    setMessage(null);
    // Bind savedDate for use in the following logic.
    const savedDate = rosterDate;
    // Initialize an object holding related fields.
    const draftSnapshot = { ...rosterDraft };
    // Bind saveRequestId for use in the following logic.
    const saveRequestId = ++rosterSaveGen.current;
    // Bind result for use in the following logic.
    const result = await runMutationWithRefresh(async () => {
      // Bind entries for use in the following logic.
      const entries = Object.entries(draftSnapshot)
        // Continue a chained call building on the previous expression.
        .filter(([, sid]) => sid)
        // Continue a chained call building on the previous expression.
        .map(([employeeId, sid]) => ({
          // Support the surrounding logic for this step.
          employeeId,
          // Provide shiftId field used by this structure.
          shiftId: sid,
        // Support the surrounding logic for this step.
        }));
      // Bind saved for use in the following logic.
      const saved = await saveShiftRoster({
        // Provide hotelDate field used by this structure.
        hotelDate: savedDate,
        // Support the surrounding logic for this step.
        entries,
      });
      // Conditional branch for the case described by this guard.
      if (
        // Invoke shouldApplyRosterSaveResult to perform this step.
        shouldApplyRosterSaveResult({
          // Support the surrounding logic for this step.
          savedDate,
          // Provide activeDate field used by this structure.
          activeDate: rosterDateRef.current,
          // Support the surrounding logic for this step.
          saveRequestId,
          // Provide latestSaveRequestId field used by this structure.
          latestSaveRequestId: rosterSaveGen.current,
        })
      // Support the surrounding logic for this step.
      ) {
        // Update React state so the UI reflects the new value.
        setRosterEntries(saved.entries);
        // Update React state so the UI reflects the new value.
        setRosterLoadedDate(savedDate);
      }
      // Return early result or rendered output from this path.
      return saved;
    });
    // Conditional branch for the case described by this guard.
    if (!result.ok) {
      // Conditional branch for the case described by this guard.
      if (result.error !== "busy") {
        // Update React state so the UI reflects the new value.
        setShiftsError(result.error);
      }
      // Return early result or rendered output from this path.
      return;
    }
    // Conditional branch for the case described by this guard.
    if (
      // Support the surrounding logic for this step.
      !shouldApplyRosterSaveResult({
        // Support the surrounding logic for this step.
        savedDate,
        // Provide activeDate field used by this structure.
        activeDate: rosterDateRef.current,
        // Support the surrounding logic for this step.
        saveRequestId,
        // Provide latestSaveRequestId field used by this structure.
        latestSaveRequestId: rosterSaveGen.current,
      })
    // Support the surrounding logic for this step.
    ) {
      // Return early result or rendered output from this path.
      return;
    }
    // Update React state so the UI reflects the new value.
    setMessage(
      // Invoke label to perform this step.
      label(
        // Support the surrounding logic for this step.
        `Ростерът за ${savedDate} е записан (${result.value.entries.length})`,
        // Support the surrounding logic for this step.
        `Roster for ${savedDate} saved (${result.value.entries.length})`,
      ),
    );
  // Support the surrounding logic for this step.
  }, [
    // Support the surrounding logic for this step.
    busyRef,
    // Support the surrounding logic for this step.
    rosterDraft,
    // Support the surrounding logic for this step.
    rosterDate,
    // Support the surrounding logic for this step.
    rosterLoadedDate,
    // Support the surrounding logic for this step.
    runMutationWithRefresh,
    // Support the surrounding logic for this step.
    setShiftsError,
    // Support the surrounding logic for this step.
    setMessage,
    // Support the surrounding logic for this step.
    label,
  // Support the surrounding logic for this step.
  ]);

  // Memoize callback identity for stable child/effect deps.
  const onRosterDraftChange = useCallback(
    // Support the surrounding logic for this step.
    (employeeId: string, shiftId: string) => {
      // Update React state so the UI reflects the new value.
      setRosterDraft((prev) => ({ ...prev, [employeeId]: shiftId }));
    },
    // Support the surrounding logic for this step.
    [],
  );

  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    shiftFormError,
    // Support the surrounding logic for this step.
    shiftMode,
    // Support the surrounding logic for this step.
    editingShift,
    // Support the surrounding logic for this step.
    shiftCode,
    // Support the surrounding logic for this step.
    shiftNameBg,
    // Support the surrounding logic for this step.
    shiftNameEn,
    // Support the surrounding logic for this step.
    shiftStart,
    // Support the surrounding logic for this step.
    shiftEnd,
    // Support the surrounding logic for this step.
    shiftSort,
    // Support the surrounding logic for this step.
    shiftActive,
    // Support the surrounding logic for this step.
    shiftDirty,
    // Support the surrounding logic for this step.
    rosterDate,
    // Support the surrounding logic for this step.
    rosterEntries,
    // Support the surrounding logic for this step.
    rosterDraft,
    // Support the surrounding logic for this step.
    rosterLoadedDate,
    // Support the surrounding logic for this step.
    setShiftCode,
    // Support the surrounding logic for this step.
    setShiftNameBg,
    // Support the surrounding logic for this step.
    setShiftNameEn,
    // Support the surrounding logic for this step.
    setShiftStart,
    // Support the surrounding logic for this step.
    setShiftEnd,
    // Support the surrounding logic for this step.
    setShiftSort,
    // Support the surrounding logic for this step.
    setShiftActive,
    // Support the surrounding logic for this step.
    setRosterDate,
    // Support the surrounding logic for this step.
    onRosterDraftChange,
    // Support the surrounding logic for this step.
    startCreateShift,
    // Support the surrounding logic for this step.
    startEditShift,
    // Support the surrounding logic for this step.
    closeShiftForm,
    // Support the surrounding logic for this step.
    onSaveShift,
    // Support the surrounding logic for this step.
    onSaveRoster,
  };
}
