import { useCallback, useEffect, useState } from "react";
import {
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

export function PlanPage({ user }: Props) {
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

  const refresh = useCallback(async () => {
    const [planData, roomData, hkData, shiftData] = await Promise.all([
      fetchDailyPlan(hotelDate),
      fetchRooms(),
      fetchHousekeepers().catch(() => []),
      fetchShifts(false).catch(() => [] as ShiftRow[]),
    ]);
    setPlan(planData);
    setRooms(roomData);
    setHousekeepers(hkData);
    setShifts(shiftData.filter((s) => s.isActive));
    if (!locationId && roomData[0]) setLocationId(roomData[0].id);
  }, [hotelDate, locationId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load plan");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

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

      {error && <div className="error banner">{error}</div>}
      {message && <div className="ok banner">{message}</div>}

      <DepartureEffectsPanel
        canManage={canManage}
        hotelDate={hotelDate}
        loading={loading}
        refresh={refresh}
        setError={setError}
        setMessage={setMessage}
      />

      <PlanLastImport plan={plan} />

      <PlanCrud
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
