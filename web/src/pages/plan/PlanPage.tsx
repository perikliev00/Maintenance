/**
 * Daily plan (Clock): manual entries + JSON import — not a live PMS sync.
 * Manage UI (import, CRUD, departure effects) requires `plan.manage`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  // Permission / capability gate.
  canPerformAction,
  fetchDailyPlan,
  fetchHousekeepers,
  fetchRooms,
  fetchShifts,
  todayHotelDate,
  type AuthUser,
  type DailyPlan,
  type Room,
  type ShiftRow,
} from "../../api/client";
import { ScopeHint } from "../../components/ScopeHint";
import { DepartureEffectsPanel } from "./DepartureEffectsPanel";
import { ImportPanel, PlanLastImport } from "./ImportPanel";
import { PlanCrud } from "./PlanCrud";

type Props = {
  user: AuthUser;
};

/**
 * Daily plan (Clock) page: date picker, departure effects, CRUD, JSON import.
 * Manage UI requires `plan.manage`.
 */
export function PlanPage({ user }: Props) {
  // Permission / capability gate.
  const canManage = canPerformAction(user, "plan.manage");
  const [hotelDate, setHotelDate] = useState(todayHotelDate);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [housekeepers, setHousekeepers] = useState<
    Array<{ id: string; fullName: string; employeeNumber: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [locationId, setLocationId] = useState("");
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const dateRef = useRef(hotelDate);
  const refreshRevision = useRef(0);
  dateRef.current = hotelDate;

  /** Load plan + lookup lists for the selected hotel date. */
  const refresh = useCallback(async () => {
    const revision = ++refreshRevision.current;
    // Housekeepers/shifts soft-fail so the plan still loads without them.
    const [planData, roomData, hkData, shiftData] = await Promise.all([
      fetchDailyPlan(hotelDate),
      fetchRooms(),
      // Promise catch handler.
      fetchHousekeepers().catch(() => []),
      // Promise catch handler.
      fetchShifts(false).catch(() => [] as ShiftRow[]),
    ]);
    if (dateRef.current !== hotelDate || refreshRevision.current !== revision) return;
    setPlan(planData);
    setRooms(roomData);
    setHousekeepers(hkData);
    // Only active shifts are assignable on new plan entries.
    setShifts(shiftData.filter((s) => s.isActive));
    // Default the create form to the first room when none selected yet.
    if (!locationId && roomData[0]) setLocationId(roomData[0].id);
  }, [hotelDate, locationId]);

  // Re-fetch when hotelDate (via refresh deps) changes; ignore late responses.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Try block for fallible work.
      try {
        setLoading(true);
        setError(null);
        // Await async step.
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load plan");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // Early / value return.
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Early / value return.
  return (
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
            type="date"
            value={hotelDate}
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
        hotelDate={hotelDate}
        loading={loading}
        refresh={refresh}
        setError={setError}
        setMessage={setMessage}
      />

      <PlanLastImport plan={plan} />

      {/* CRUD + import as children; both respect canManage. */}
      <PlanCrud
        // Permission / capability gate.
        canManage={canManage}
        hotelDate={hotelDate}
        plan={plan}
        rooms={rooms}
        housekeepers={housekeepers}
        shifts={shifts}
        loading={loading}
        locationId={locationId}
        setLocationId={setLocationId}
        refresh={refresh}
        setError={setError}
        setMessage={setMessage}
      >
        <ImportPanel
          // Permission / capability gate.
          canManage={canManage}
          hotelDate={hotelDate}
          setHotelDate={setHotelDate}
          setPlan={setPlan}
          setError={setError}
          setMessage={setMessage}
        />
      </PlanCrud>
    </main>
  );
}
