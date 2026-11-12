/**
 * 3-step access-card issue wizard: lookups, validation, and submit.
 * Staff list/revoke lives in `useStaffCards` so loading flags stay separate.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  fetchCardEmployees,
  // Support the surrounding logic for this step.
  fetchRooms,
  // Support the surrounding logic for this step.
  issueCard,
  // Declare type alias AccessCard.
  type AccessCard,
  // Declare type alias CardEmployeeOption.
  type CardEmployeeOption,
  // Declare type alias CardType.
  type CardType,
  // Declare type alias Room.
  type Room,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ../../i18n.
import { t } from "../../i18n";
// Import module dependency from ./cardLabels.
import { defaultValidity, toIsoLocal } from "./cardLabels";

// Export type definition for consumers of this module.
export type WizardStep = 1 | 2 | 3;

// Export type definition for consumers of this module.
export type UseCardIssueWizardOptions = {
  // Provide locale field used by this structure.
  locale: "bg" | "en";
  // Provide canIssue field used by this structure.
  canIssue: boolean;
  // Provide setError field used by this structure.
  setError: (message: string | null) => void;
  // Provide setMessage field used by this structure.
  setMessage: (message: string | null) => void;
};

// Export function useCardIssueWizard as part of this module's API.
export function useCardIssueWizard({
  // Support the surrounding logic for this step.
  locale,
  // Support the surrounding logic for this step.
  canIssue,
  // Support the surrounding logic for this step.
  setError,
  // Support the surrounding logic for this step.
  setMessage,
// Support the surrounding logic for this step.
}: UseCardIssueWizardOptions) {
  // Hold a mutable ref that persists across renders without re-render.
  const issueInFlight = useRef(false);
  // React state slot for local UI/data that can change over time.
  const [step, setStep] = useState<WizardStep>(1);
  // React state slot for local UI/data that can change over time.
  const [cardType, setCardType] = useState<CardType | null>(null);
  // React state slot for local UI/data that can change over time.
  const [locationId, setLocationId] = useState("");
  // React state slot for local UI/data that can change over time.
  const [employeeId, setEmployeeId] = useState("");
  // React state slot for local UI/data that can change over time.
  const [label, setLabel] = useState("");
  // React state slot for local UI/data that can change over time.
  const [validity, setValidity] = useState(defaultValidity);
  // React state slot for local UI/data that can change over time.
  const [rooms, setRooms] = useState<Room[]>([]);
  // React state slot for local UI/data that can change over time.
  const [employees, setEmployees] = useState<CardEmployeeOption[]>([]);
  // React state slot for local UI/data that can change over time.
  const [lookupsLoading, setLookupsLoading] = useState(false);
  // React state slot for local UI/data that can change over time.
  const [issuing, setIssuing] = useState(false);
  // React state slot for local UI/data that can change over time.
  const [issued, setIssued] = useState<AccessCard | null>(null);

  // Bind isGuest for use in the following logic.
  const isGuest = cardType === "guest";
  // Bind isMaster for use in the following logic.
  const isMaster = cardType === "master";
  // Bind isStaff for use in the following logic.
  const isStaff = !!cardType && cardType !== "guest";

  // Memoize derived value to avoid recomputing every render.
  const selectedRoom = useMemo(
    // Support the surrounding logic for this step.
    () => rooms.find((r) => r.id === locationId) ?? null,
    // Support the surrounding logic for this step.
    [rooms, locationId],
  );
  // Memoize derived value to avoid recomputing every render.
  const selectedEmployee = useMemo(
    // Support the surrounding logic for this step.
    () => employees.find((e) => e.id === employeeId) ?? null,
    // Support the surrounding logic for this step.
    [employees, employeeId],
  );

  // Memoize callback identity for stable child/effect deps.
  const loadIssueLookups = useCallback(async () => {
    // Skip employee fetch when the user cannot issue (no need for PII).
    const [roomList, empList] = await Promise.all([
      // Invoke fetchRooms to perform this step.
      fetchRooms(),
      // Support the surrounding logic for this step.
      canIssue ? fetchCardEmployees() : Promise.resolve([]),
    // Support the surrounding logic for this step.
    ]);
    // Update React state so the UI reflects the new value.
    setRooms(roomList.filter((r) => r.catalogStatus === "active"));
    // Update React state so the UI reflects the new value.
    setEmployees(empList);
  // Support the surrounding logic for this step.
  }, [canIssue]);

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Support the surrounding logic for this step.
    (async () => {
      // Begin guarded block to catch runtime failures.
      try {
        // Update React state so the UI reflects the new value.
        setLookupsLoading(true);
        // Update React state so the UI reflects the new value.
        setError(null);
        // Wait for an async operation before continuing.
        await loadIssueLookups();
      // Support the surrounding logic for this step.
      } catch (err) {
        // Update React state so the UI reflects the new value.
        setError(
          // Support the surrounding logic for this step.
          err instanceof Error
            // Support the surrounding logic for this step.
            ? err.message
            // Support the surrounding logic for this step.
            : t(locale, "Грешка при зареждане", "Failed to load"),
        );
      // Support the surrounding logic for this step.
      } finally {
        // Update React state so the UI reflects the new value.
        setLookupsLoading(false);
      }
    // Support the surrounding logic for this step.
    })();
  // Support the surrounding logic for this step.
  }, [loadIssueLookups, locale, setError]);

  // Define function resetWizard and its behavior.
  function resetWizard() {
    // Update React state so the UI reflects the new value.
    setStep(1);
    // Update React state so the UI reflects the new value.
    setCardType(null);
    // Update React state so the UI reflects the new value.
    setLocationId("");
    // Update React state so the UI reflects the new value.
    setEmployeeId("");
    // Update React state so the UI reflects the new value.
    setLabel("");
    // Update React state so the UI reflects the new value.
    setValidity(defaultValidity());
    // Update React state so the UI reflects the new value.
    setIssued(null);
    // Update React state so the UI reflects the new value.
    setMessage(null);
    // Update React state so the UI reflects the new value.
    setError(null);
  }

  // Define function selectCardType and its behavior.
  function selectCardType(type: CardType) {
    // Changing type clears prior room/employee selections.
    setCardType(type);
    // Update React state so the UI reflects the new value.
    setLocationId("");
    // Update React state so the UI reflects the new value.
    setEmployeeId("");
  }

  // Define function validateStep2 and its behavior.
  function validateStep2() {
    // Conditional branch for the case described by this guard.
    if (!cardType) return t(locale, "Изберете тип карта", "Select a card type");
    // Conditional branch for the case described by this guard.
    if (isGuest && !locationId) return t(locale, "Изберете стая", "Select a room");
    // Conditional branch for the case described by this guard.
    if (isStaff && !employeeId)
      // Return early result or rendered output from this path.
      return t(locale, "Изберете служител", "Select an employee");
    // Conditional branch for the case described by this guard.
    if (isMaster && locationId)
      // Return early result or rendered output from this path.
      return t(
        // Support the surrounding logic for this step.
        locale,
        // Support the surrounding logic for this step.
        "Мастър картата е за целия имот",
        // Support the surrounding logic for this step.
        "Master card covers the whole property",
      );
    // Begin guarded block to catch runtime failures.
    try {
      // Bind from for use in the following logic.
      const from = new Date(toIsoLocal(validity.validFrom));
      // Bind until for use in the following logic.
      const until = new Date(toIsoLocal(validity.validUntil));
      // Conditional branch for the case described by this guard.
      if (!(until > from))
        // Return early result or rendered output from this path.
        return t(
          // Support the surrounding logic for this step.
          locale,
          // Support the surrounding logic for this step.
          "Краят трябва да е след началото",
          // Support the surrounding logic for this step.
          "End must be after start",
        );
    // Support the surrounding logic for this step.
    } catch {
      // Return early result or rendered output from this path.
      return t(locale, "Невалиден срок", "Invalid validity window");
    }
    // Return early result or rendered output from this path.
    return null;
  }

  // Define function goToStep3 and its behavior.
  function goToStep3() {
    // Bind problem for use in the following logic.
    const problem = validateStep2();
    // Conditional branch for the case described by this guard.
    if (problem) {
      // Update React state so the UI reflects the new value.
      setError(problem);
      // Return early result or rendered output from this path.
      return;
    }
    // Update React state so the UI reflects the new value.
    setError(null);
    // Update React state so the UI reflects the new value.
    setStep(3);
  }

  // Define function submitIssue and its behavior.
  async function submitIssue() {
    // Conditional branch for the case described by this guard.
    if (!cardType || !canIssue || issueInFlight.current) return;
    // Bind problem for use in the following logic.
    const problem = validateStep2();
    // Conditional branch for the case described by this guard.
    if (problem) {
      // Update React state so the UI reflects the new value.
      setError(problem);
      // Return early result or rendered output from this path.
      return;
    }
    // Support the surrounding logic for this step.
    issueInFlight.current = true;
    // Begin guarded block to catch runtime failures.
    try {
      // Update React state so the UI reflects the new value.
      setIssuing(true);
      // Update React state so the UI reflects the new value.
      setError(null);
      // Bind card for use in the following logic.
      const card = await issueCard({
        // Support the surrounding logic for this step.
        cardType,
        // Provide employeeId field used by this structure.
        employeeId: isGuest ? null : employeeId,
        // Provide locationId field used by this structure.
        locationId:
          // Support the surrounding logic for this step.
          isGuest || (!isMaster && locationId) ? locationId || null : null,
        // Provide validFrom field used by this structure.
        validFrom: toIsoLocal(validity.validFrom),
        // Provide validUntil field used by this structure.
        validUntil: toIsoLocal(validity.validUntil),
        // Provide label field used by this structure.
        label: label.trim() || null,
      });
      // Update React state so the UI reflects the new value.
      setIssued(card);
      // Update React state so the UI reflects the new value.
      setMessage(t(locale, "Записано в системата", "Saved in the system"));
    // Support the surrounding logic for this step.
    } catch (err) {
      // Update React state so the UI reflects the new value.
      setError(
        // Support the surrounding logic for this step.
        err instanceof Error
          // Support the surrounding logic for this step.
          ? err.message
          // Support the surrounding logic for this step.
          : t(locale, "Неуспешно издаване", "Issue failed"),
      );
    // Support the surrounding logic for this step.
    } finally {
      // Update React state so the UI reflects the new value.
      setIssuing(false);
      // Support the surrounding logic for this step.
      issueInFlight.current = false;
    }
  }

  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    step,
    // Support the surrounding logic for this step.
    setStep,
    // Support the surrounding logic for this step.
    cardType,
    // Support the surrounding logic for this step.
    selectCardType,
    // Support the surrounding logic for this step.
    locationId,
    // Support the surrounding logic for this step.
    setLocationId,
    // Support the surrounding logic for this step.
    employeeId,
    // Support the surrounding logic for this step.
    setEmployeeId,
    // Support the surrounding logic for this step.
    label,
    // Support the surrounding logic for this step.
    setLabel,
    // Support the surrounding logic for this step.
    validity,
    // Support the surrounding logic for this step.
    setValidity,
    // Support the surrounding logic for this step.
    rooms,
    // Support the surrounding logic for this step.
    employees,
    // Support the surrounding logic for this step.
    lookupsLoading,
    // Support the surrounding logic for this step.
    issuing,
    // Support the surrounding logic for this step.
    issued,
    // Support the surrounding logic for this step.
    isGuest,
    // Support the surrounding logic for this step.
    isMaster,
    // Support the surrounding logic for this step.
    isStaff,
    // Support the surrounding logic for this step.
    selectedRoom,
    // Support the surrounding logic for this step.
    selectedEmployee,
    // Support the surrounding logic for this step.
    resetWizard,
    // Support the surrounding logic for this step.
    validateStep2,
    // Support the surrounding logic for this step.
    goToStep3,
    // Support the surrounding logic for this step.
    submitIssue,
  };
}
