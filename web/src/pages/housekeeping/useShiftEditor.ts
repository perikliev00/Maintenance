import {
  FormEvent,
  MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createShift,
  fetchShiftRoster,
  saveShiftRoster,
  todayHotelDate,
  updateShift,
  type ShiftRosterEntry,
  type ShiftRow,
} from "../../api/client";
import type { BusyMutationResult } from "../../hooks/useBusyMutation";
import {
  canSaveRosterDraft,
  shouldApplyRosterLoad,
  shouldApplyRosterSaveResult,
} from "./shiftRosterLoadLogic";

export type ShiftFormMode = "closed" | "create" | "edit";

type RunMutationWithRefresh = <T>(
  mutate: () => Promise<T>,
  refresh?: () => Promise<void>,
) => Promise<BusyMutationResult<T>>;

export type UseShiftEditorOptions = {
  tab: "catalog" | "sectors" | "shifts";
  canManageShifts: boolean;
  refreshShifts: () => Promise<void>;
  setShiftsError: (err: string | null) => void;
  setMessage: (msg: string | null) => void;
  label: (bg: string, en: string) => string;
  busyRef: MutableRefObject<boolean>;
  runMutationWithRefresh: RunMutationWithRefresh;
};

// Export function useShiftEditor as part of this module's API.
export function useShiftEditor(options: UseShiftEditorOptions) {
  const {
    tab,
    canManageShifts,
    refreshShifts,
    setShiftsError,
    setMessage,
    label,
    busyRef,
    runMutationWithRefresh,
  } = options;

  const [shiftMode, setShiftMode] = useState<ShiftFormMode>("closed");
  const [editingShift, setEditingShift] = useState<ShiftRow | null>(null);
  const [shiftCode, setShiftCode] = useState("");
  const [shiftNameBg, setShiftNameBg] = useState("");
  const [shiftNameEn, setShiftNameEn] = useState("");
  const [shiftStart, setShiftStart] = useState("06:00");
  const [shiftEnd, setShiftEnd] = useState("14:00");
  const [shiftSort, setShiftSort] = useState(0);
  const [shiftActive, setShiftActive] = useState(true);
  const [shiftFormError, setShiftFormError] = useState<string | null>(null);
  const [shiftBaseline, setShiftBaseline] = useState("");

  const [rosterDate, setRosterDateState] = useState(todayHotelDate());
  const [rosterEntries, setRosterEntries] = useState<ShiftRosterEntry[]>([]);
  const [rosterDraft, setRosterDraft] = useState<Record<string, string>>({});
  const [rosterLoadedDate, setRosterLoadedDate] = useState<string | null>(null);
  const rosterDateRef = useRef(rosterDate);
  rosterDateRef.current = rosterDate;
  const rosterLoadGen = useRef(0);
  const rosterSaveGen = useRef(0);

  const setRosterDate = useCallback((date: string) => {
    // Invalidate in-flight GETs/PUTs for the previous day (incl. A→B→A).
    rosterLoadGen.current += 1;
    setRosterLoadedDate(null);
    setRosterDateState(date);
  }, []);

  const refreshRoster = useCallback(
    async (date: string) => {
      if (!canManageShifts) return;
      const requestId = ++rosterLoadGen.current;
      try {
        const roster = await fetchShiftRoster(date);
        if (
          !shouldApplyRosterLoad({
            requestDate: date,
            activeDate: rosterDateRef.current,
            requestId,
            latestRequestId: rosterLoadGen.current,
          })
        ) {
          return;
        }
        setRosterEntries(roster.entries);
        const draft: Record<string, string> = {};
        for (const e of roster.entries) {
          draft[e.employee.id] = e.shift.id;
        }
        setRosterDraft(draft);
        setRosterLoadedDate(date);
      } catch (err) {
        if (
          !shouldApplyRosterLoad({
            requestDate: date,
            activeDate: rosterDateRef.current,
            requestId,
            latestRequestId: rosterLoadGen.current,
          })
        ) {
          return;
        }
        setRosterLoadedDate(null);
        // Abort this path by throwing an error to callers.
        throw err;
      }
    },
    [canManageShifts],
  );

  useEffect(() => {
    if (tab !== "shifts" || !canManageShifts) return;
    // Fire-and-forget async work without awaiting in this path.
    void refreshRoster(rosterDate).catch((err) => {
      setShiftsError(
        err instanceof Error ? err.message : "Failed to load roster",
      );
    });
  }, [tab, rosterDate, canManageShifts, refreshRoster, setShiftsError]);

  // Memoize derived value to avoid recomputing every render.
  const shiftSnapshot = useMemo(
    () =>
      JSON.stringify({
        shiftCode,
        shiftNameBg,
        shiftNameEn,
        shiftStart,
        shiftEnd,
        shiftSort,
        shiftActive,
      }),
    [
      shiftCode,
      shiftNameBg,
      shiftNameEn,
      shiftStart,
      shiftEnd,
      shiftSort,
      shiftActive,
    ],
  );
  const shiftDirty =
    shiftMode !== "closed" && shiftSnapshot !== shiftBaseline;

  const closeShiftForm = useCallback(
    (opts?: { force?: boolean }) => {
      if (!opts?.force && busyRef.current) return;
      setShiftMode("closed");
      setEditingShift(null);
      setShiftCode("");
      setShiftNameBg("");
      setShiftNameEn("");
      setShiftStart("06:00");
      setShiftEnd("14:00");
      setShiftSort(0);
      setShiftActive(true);
      setShiftFormError(null);
      setShiftBaseline("");
    },
    [busyRef],
  );

  const startCreateShift = useCallback(() => {
    if (!canManageShifts || busyRef.current) return;
    setShiftMode("create");
    setEditingShift(null);
    setShiftCode("");
    setShiftNameBg("");
    setShiftNameEn("");
    setShiftStart("06:00");
    setShiftEnd("14:00");
    setShiftSort(0);
    setShiftActive(true);
    setMessage(null);
    setShiftFormError(null);
    setShiftBaseline(
      JSON.stringify({
        shiftCode: "",
        shiftNameBg: "",
        shiftNameEn: "",
        shiftStart: "06:00",
        shiftEnd: "14:00",
        shiftSort: 0,
        shiftActive: true,
      }),
    );
  }, [canManageShifts, busyRef, setMessage]);

  const startEditShift = useCallback(
    (shift: ShiftRow) => {
      if (busyRef.current) return;
      setShiftMode("edit");
      setEditingShift(shift);
      setShiftCode(shift.code);
      setShiftNameBg(shift.nameBg);
      setShiftNameEn(shift.nameEn);
      setShiftStart(shift.startTime);
      setShiftEnd(shift.endTime);
      setShiftSort(shift.sortOrder);
      setShiftActive(shift.isActive);
      setMessage(null);
      setShiftFormError(null);
      setShiftBaseline(
        JSON.stringify({
          shiftCode: shift.code,
          shiftNameBg: shift.nameBg,
          shiftNameEn: shift.nameEn,
          shiftStart: shift.startTime,
          shiftEnd: shift.endTime,
          shiftSort: shift.sortOrder,
          shiftActive: shift.isActive,
        }),
      );
    },
    [busyRef, setMessage],
  );

  const onSaveShift = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canManageShifts || busyRef.current) return;
      setMessage(null);
      setShiftsError(null);
      setShiftFormError(null);
      const editing = Boolean(editingShift);

      const result = await runMutationWithRefresh(async () => {
        if (editingShift) {
          await updateShift(editingShift.id, {
            code: shiftCode,
            nameBg: shiftNameBg,
            nameEn: shiftNameEn,
            startTime: shiftStart,
            endTime: shiftEnd,
            sortOrder: shiftSort,
            isActive: shiftActive,
          });
        } else {
          await createShift({
            code: shiftCode,
            nameBg: shiftNameBg,
            nameEn: shiftNameEn,
            startTime: shiftStart,
            endTime: shiftEnd,
            sortOrder: shiftSort,
            isActive: shiftActive,
          });
        }
        closeShiftForm({ force: true });
      }, refreshShifts);

      if (!result.ok) {
        if (result.error !== "busy") {
          setShiftFormError(result.error);
        }
        return;
      }
      if (result.outcome === "saved_refresh_failed") {
        const detail = result.refreshError
          ? `: ${result.refreshError}`
          : "";
        setShiftsError(
          `${label(
            "Записът е успешен, но обновяването се провали",
            "Saved, but refresh failed",
          )}${detail}`,
        );
      }
      if (
        result.outcome === "saved" ||
        result.outcome === "saved_refresh_failed"
      ) {
        setMessage(
          editing
            ? label("Смяната е обновена", "Shift updated")
            : label("Смяната е създадена", "Shift created"),
        );
      }
    },
    [
      canManageShifts,
      busyRef,
      runMutationWithRefresh,
      editingShift,
      shiftCode,
      shiftNameBg,
      shiftNameEn,
      shiftStart,
      shiftEnd,
      shiftSort,
      shiftActive,
      closeShiftForm,
      refreshShifts,
      setShiftsError,
      label,
      setMessage,
    ],
  );

  const onSaveRoster = useCallback(async () => {
    if (
      !canSaveRosterDraft({
        activeDate: rosterDate,
        loadedDate: rosterLoadedDate,
        busy: busyRef.current,
      })
    ) {
      return;
    }
    setShiftsError(null);
    setMessage(null);
    const savedDate = rosterDate;
    const draftSnapshot = { ...rosterDraft };
    const saveRequestId = ++rosterSaveGen.current;
    const result = await runMutationWithRefresh(async () => {
      const entries = Object.entries(draftSnapshot)
        .filter(([, sid]) => sid)
        .map(([employeeId, sid]) => ({
          employeeId,
          shiftId: sid,
        }));
      const saved = await saveShiftRoster({
        hotelDate: savedDate,
        entries,
      });
      if (
        shouldApplyRosterSaveResult({
          savedDate,
          activeDate: rosterDateRef.current,
          saveRequestId,
          latestSaveRequestId: rosterSaveGen.current,
        })
      ) {
        setRosterEntries(saved.entries);
        setRosterLoadedDate(savedDate);
      }
      return saved;
    });
    if (!result.ok) {
      if (result.error !== "busy") {
        setShiftsError(result.error);
      }
      return;
    }
    if (
      !shouldApplyRosterSaveResult({
        savedDate,
        activeDate: rosterDateRef.current,
        saveRequestId,
        latestSaveRequestId: rosterSaveGen.current,
      })
    ) {
      return;
    }
    setMessage(
      label(
        `Ростерът за ${savedDate} е записан (${result.value.entries.length})`,
        `Roster for ${savedDate} saved (${result.value.entries.length})`,
      ),
    );
  }, [
    busyRef,
    rosterDraft,
    rosterDate,
    rosterLoadedDate,
    runMutationWithRefresh,
    setShiftsError,
    setMessage,
    label,
  ]);

  const onRosterDraftChange = useCallback(
    (employeeId: string, shiftId: string) => {
      setRosterDraft((prev) => ({ ...prev, [employeeId]: shiftId }));
    },
    [],
  );

  return {
    shiftFormError,
    shiftMode,
    editingShift,
    shiftCode,
    shiftNameBg,
    shiftNameEn,
    shiftStart,
    shiftEnd,
    shiftSort,
    shiftActive,
    shiftDirty,
    rosterDate,
    rosterEntries,
    rosterDraft,
    rosterLoadedDate,
    setShiftCode,
    setShiftNameBg,
    setShiftNameEn,
    setShiftStart,
    setShiftEnd,
    setShiftSort,
    setShiftActive,
    setRosterDate,
    onRosterDraftChange,
    startCreateShift,
    startEditShift,
    closeShiftForm,
    onSaveShift,
    onSaveRoster,
  };
}
