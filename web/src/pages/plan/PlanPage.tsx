/**
 * Daily plan (Clock): manual entries + JSON import — not a live PMS sync.
 * Manage UI (import, CRUD, departure effects) requires `plan.manage`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
// Import module dependency used by this file.
import {
  // Permission / capability gate.
  canPerformAction,
  // Support the surrounding logic for this step.
  fetchDailyPlan,
  // Support the surrounding logic for this step.
  fetchHousekeepers,
  // Support the surrounding logic for this step.
  fetchRooms,
  // Support the surrounding logic for this step.
  fetchShifts,
  // Support the surrounding logic for this step.
  todayHotelDate,
  // Declare type alias AuthUser.
  type AuthUser,
  // Declare type alias DailyPlan.
  type DailyPlan,
  // Declare type alias Room.
  type Room,
  // Declare type alias ShiftRow.
  type ShiftRow,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ../../components/ScopeHint.
import { ScopeHint } from "../../components/ScopeHint";
// Import module dependency from ./DepartureEffectsPanel.
import { DepartureEffectsPanel } from "./DepartureEffectsPanel";
// Import module dependency from ./ImportPanel.
import { ImportPanel, PlanLastImport } from "./ImportPanel";
// Import module dependency from ./PlanCrud.
import { PlanCrud } from "./PlanCrud";

// Declare type alias Props.
type Props = {
  // Provide user field used by this structure.
  user: AuthUser;
};

/**
 * Daily plan (Clock) page: date picker, departure effects, CRUD, JSON import.
 * Manage UI requires `plan.manage`.
 */
export function PlanPage({ user }: Props) {
  // Permission / capability gate.
  const canManage = canPerformAction(user, "plan.manage");
  // React state slot for local UI/data that can change over time.
  const [hotelDate, setHotelDate] = useState(todayHotelDate);
  // React state slot for local UI/data that can change over time.
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  // React state slot for local UI/data that can change over time.
  const [rooms, setRooms] = useState<Room[]>([]);
  // React state slot for local UI/data that can change over time.
  const [housekeepers, setHousekeepers] = useState<
    // Support the surrounding logic for this step.
    Array<{ id: string; fullName: string; employeeNumber: string }>
  // Support the surrounding logic for this step.
  >([]);
  // React state slot for local UI/data that can change over time.
  const [loading, setLoading] = useState(true);
  // React state slot for local UI/data that can change over time.
  const [error, setError] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [message, setMessage] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [locationId, setLocationId] = useState("");
  // React state slot for local UI/data that can change over time.
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  // Hold a mutable ref that persists across renders without re-render.
  const dateRef = useRef(hotelDate);
  // Hold a mutable ref that persists across renders without re-render.
  const refreshRevision = useRef(0);
  // Support the surrounding logic for this step.
  dateRef.current = hotelDate;

  /** Load plan + lookup lists for the selected hotel date. */
  const refresh = useCallback(async () => {
    // Bind revision for use in the following logic.
    const revision = ++refreshRevision.current;
    // Housekeepers/shifts soft-fail so the plan still loads without them.
    const [planData, roomData, hkData, shiftData] = await Promise.all([
      // Invoke fetchDailyPlan to perform this step.
      fetchDailyPlan(hotelDate),
      // Invoke fetchRooms to perform this step.
      fetchRooms(),
      // Promise catch handler.
      fetchHousekeepers().catch(() => []),
      // Promise catch handler.
      fetchShifts(false).catch(() => [] as ShiftRow[]),
    // Support the surrounding logic for this step.
    ]);
    // Conditional branch for the case described by this guard.
    if (dateRef.current !== hotelDate || refreshRevision.current !== revision) return;
    // State transition.
    setPlan(planData);
    // State transition.
    setRooms(roomData);
    // State transition.
    setHousekeepers(hkData);
    // Only active shifts are assignable on new plan entries.
    setShifts(shiftData.filter((s) => s.isActive));
    // Default the create form to the first room when none selected yet.
    if (!locationId && roomData[0]) setLocationId(roomData[0].id);
  // Support the surrounding logic for this step.
  }, [hotelDate, locationId]);

  // Re-fetch when hotelDate (via refresh deps) changes; ignore late responses.
  useEffect(() => {
    // Bind cancelled for use in the following logic.
    let cancelled = false;
    // Support the surrounding logic for this step.
    (async () => {
      // Try block for fallible work.
      try {
        // State transition.
        setLoading(true);
        // State transition.
        setError(null);
        // Await async step.
        await refresh();
      // Support the surrounding logic for this step.
      } catch (err) {
        // Branch: conditional gate.
        if (!cancelled) {
          // State transition.
          setError(err instanceof Error ? err.message : "Failed to load plan");
        }
      // Support the surrounding logic for this step.
      } finally {
        // Branch: conditional gate.
        if (!cancelled) setLoading(false);
      }
    // Support the surrounding logic for this step.
    })();
    // Early / value return.
    return () => {
      // Support the surrounding logic for this step.
      cancelled = true;
    };
  // Support the surrounding logic for this step.
  }, [refresh]);

  // Early / value return.
  return (
    // Render a <main> element for layout or semantics.
    <main className="content">
      <header className="page-header">
        <div>
          <h1>Дневен план (Clock)</h1>
          <p>
            Ръчен план и договорен JSON импорт — не жива PMS/Clock синхронизация
          </p>
          <ScopeHint user={user} />
        </div>
        <label className="inline-search">
          Дата
          <input
            // Declare a type alias.
            type="date"
            // Pass value prop/value into the element or config.
            value={hotelDate}
            // Pass onChange prop/value into the element or config.
            onChange={(e) => setHotelDate(e.target.value)}
          />
        </label>
      </header>

      {/* Render branch: error && <div className="error banner">error</div> */}
      {error && <div className="error banner">{error}</div>}
      {/* Render branch: message && <div className="ok banner">message</div> */}
      {message && <div className="ok banner">{message}</div>}

      {/* Deferred vacant/dirty apply — gated inside the panel. */}
      <DepartureEffectsPanel
        // Permission / capability gate.
        canManage={canManage}
        // Pass hotelDate prop/value into the element or config.
        hotelDate={hotelDate}
        // Pass loading prop/value into the element or config.
        loading={loading}
        // Pass refresh prop/value into the element or config.
        refresh={refresh}
        // Pass setError prop/value into the element or config.
        setError={setError}
        // Pass setMessage prop/value into the element or config.
        setMessage={setMessage}
      />

      <PlanLastImport plan={plan} />

      {/* CRUD + import as children; both respect canManage. */}
      <PlanCrud
        // Permission / capability gate.
        canManage={canManage}
        // Pass hotelDate prop/value into the element or config.
        hotelDate={hotelDate}
        // Pass plan prop/value into the element or config.
        plan={plan}
        // Pass rooms prop/value into the element or config.
        rooms={rooms}
        // Pass housekeepers prop/value into the element or config.
        housekeepers={housekeepers}
        // Pass shifts prop/value into the element or config.
        shifts={shifts}
        // Pass loading prop/value into the element or config.
        loading={loading}
        // Pass locationId prop/value into the element or config.
        locationId={locationId}
        // Pass setLocationId prop/value into the element or config.
        setLocationId={setLocationId}
        // Pass refresh prop/value into the element or config.
        refresh={refresh}
        // Pass setError prop/value into the element or config.
        setError={setError}
        // Pass setMessage prop/value into the element or config.
        setMessage={setMessage}
      >
        <ImportPanel
          // Permission / capability gate.
          canManage={canManage}
          // Pass hotelDate prop/value into the element or config.
          hotelDate={hotelDate}
          // Pass setHotelDate prop/value into the element or config.
          setHotelDate={setHotelDate}
          // Pass setPlan prop/value into the element or config.
          setPlan={setPlan}
          // Pass setError prop/value into the element or config.
          setError={setError}
          // Pass setMessage prop/value into the element or config.
          setMessage={setMessage}
        />
      </PlanCrud>
    </main>
  );
}
