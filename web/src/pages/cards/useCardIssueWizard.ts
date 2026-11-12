/**
 * 3-step access-card issue wizard: lookups, validation, and submit.
 * Staff list/revoke lives in `useStaffCards` so loading flags stay separate.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCardEmployees,
  fetchRooms,
  issueCard,
  type AccessCard,
  type CardEmployeeOption,
  type CardType,
  type Room,
} from "../../api/client";
import { t } from "../../i18n";
import { defaultValidity, toIsoLocal } from "./cardLabels";

export type WizardStep = 1 | 2 | 3;

export type UseCardIssueWizardOptions = {
  locale: "bg" | "en";
  canIssue: boolean;
  setError: (message: string | null) => void;
  setMessage: (message: string | null) => void;
};

// Export function useCardIssueWizard as part of this module's API.
export function useCardIssueWizard({
  locale,
  canIssue,
  setError,
  setMessage,
}: UseCardIssueWizardOptions) {
  const issueInFlight = useRef(false);
  const [step, setStep] = useState<WizardStep>(1);
  const [cardType, setCardType] = useState<CardType | null>(null);
  const [locationId, setLocationId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [label, setLabel] = useState("");
  const [validity, setValidity] = useState(defaultValidity);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [employees, setEmployees] = useState<CardEmployeeOption[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<AccessCard | null>(null);

  const isGuest = cardType === "guest";
  const isMaster = cardType === "master";
  const isStaff = !!cardType && cardType !== "guest";

  // Memoize derived value to avoid recomputing every render.
  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === locationId) ?? null,
    [rooms, locationId],
  );
  // Memoize derived value to avoid recomputing every render.
  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === employeeId) ?? null,
    [employees, employeeId],
  );

  const loadIssueLookups = useCallback(async () => {
    // Skip employee fetch when the user cannot issue (no need for PII).
    const [roomList, empList] = await Promise.all([
      fetchRooms(),
      canIssue ? fetchCardEmployees() : Promise.resolve([]),
    ]);
    setRooms(roomList.filter((r) => r.catalogStatus === "active"));
    setEmployees(empList);
  }, [canIssue]);

  useEffect(() => {
    (async () => {
      try {
        setLookupsLoading(true);
        setError(null);
        await loadIssueLookups();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t(locale, "Грешка при зареждане", "Failed to load"),
        );
      } finally {
        setLookupsLoading(false);
      }
    })();
  }, [loadIssueLookups, locale, setError]);

  // Define function resetWizard and its behavior.
  function resetWizard() {
    setStep(1);
    setCardType(null);
    setLocationId("");
    setEmployeeId("");
    setLabel("");
    setValidity(defaultValidity());
    setIssued(null);
    setMessage(null);
    setError(null);
  }

  // Define function selectCardType and its behavior.
  function selectCardType(type: CardType) {
    // Changing type clears prior room/employee selections.
    setCardType(type);
    setLocationId("");
    setEmployeeId("");
  }

  // Define function validateStep2 and its behavior.
  function validateStep2() {
    if (!cardType) return t(locale, "Изберете тип карта", "Select a card type");
    if (isGuest && !locationId) return t(locale, "Изберете стая", "Select a room");
    if (isStaff && !employeeId)
      return t(locale, "Изберете служител", "Select an employee");
    if (isMaster && locationId)
      return t(
        locale,
        "Мастър картата е за целия имот",
        "Master card covers the whole property",
      );
    try {
      const from = new Date(toIsoLocal(validity.validFrom));
      const until = new Date(toIsoLocal(validity.validUntil));
      if (!(until > from))
        return t(
          locale,
          "Краят трябва да е след началото",
          "End must be after start",
        );
    } catch {
      return t(locale, "Невалиден срок", "Invalid validity window");
    }
    return null;
  }

  // Define function goToStep3 and its behavior.
  function goToStep3() {
    const problem = validateStep2();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep(3);
  }

  // Define function submitIssue and its behavior.
  async function submitIssue() {
    if (!cardType || !canIssue || issueInFlight.current) return;
    const problem = validateStep2();
    if (problem) {
      setError(problem);
      return;
    }
    issueInFlight.current = true;
    try {
      setIssuing(true);
      setError(null);
      const card = await issueCard({
        cardType,
        employeeId: isGuest ? null : employeeId,
        locationId:
          isGuest || (!isMaster && locationId) ? locationId || null : null,
        validFrom: toIsoLocal(validity.validFrom),
        validUntil: toIsoLocal(validity.validUntil),
        label: label.trim() || null,
      });
      setIssued(card);
      setMessage(t(locale, "Записано в системата", "Saved in the system"));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t(locale, "Неуспешно издаване", "Issue failed"),
      );
    } finally {
      setIssuing(false);
      issueInFlight.current = false;
    }
  }

  return {
    step,
    setStep,
    cardType,
    selectCardType,
    locationId,
    setLocationId,
    employeeId,
    setEmployeeId,
    label,
    setLabel,
    validity,
    setValidity,
    rooms,
    employees,
    lookupsLoading,
    issuing,
    issued,
    isGuest,
    isMaster,
    isStaff,
    selectedRoom,
    selectedEmployee,
    resetWizard,
    validateStep2,
    goToStep3,
    submitIssue,
  };
}
