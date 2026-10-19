import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { useLiveRefresh } from "../src/hooks/useLiveRefresh";
import { PlanPage } from "../src/pages/plan/PlanPage";
import { ImportPanel } from "../src/pages/plan/ImportPanel";
import { DepartureEffectsPanel } from "../src/pages/plan/DepartureEffectsPanel";
import { RoomQrPage } from "../src/pages/RoomQrPage";
import { CardsPage } from "../src/pages/CardsPage";
import { AttendancePage } from "../src/pages/AttendancePage";
import { LiveBoardPage } from "../src/pages/LiveBoardPage";
import { RepairsPage } from "../src/pages/RepairsPage";
import { useLocationAudit } from "../src/pages/locations/audit";
import { AnalyticsPage } from "../src/pages/AnalyticsPage";

export function mountScreen(name: string, user: any) {
  const root = createRoot(document.getElementById("root")!);
  let setProps!: (value: any) => void;
  function Screen() {
    const [props, change] = useState<any>({ token: "A", hotelDate: "2000-01-01", locationId: "A" }); setProps = change;
    const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
    let content: React.ReactNode;
    if (name === "plan") content = <PlanPage user={user} />;
    else if (name === "qr") content = <RoomQrPage user={user} token={props.token} onClose={() => {}} />;
    else if (name === "cards") content = <CardsPage user={user} />;
    else if (name === "attendance") content = <AttendancePage user={user} />;
    else if (name === "live") content = <LiveBoardPage user={user} locale="en" />;
    else if (name === "repairs") content = <RepairsPage user={user} locale="en" />;
    else if (name === "analytics") content = <AnalyticsPage />;
    else if (name === "import") content = <ImportPanel canManage hotelDate={props.hotelDate} setHotelDate={() => {}} setPlan={() => {}} setError={setError} setMessage={setMessage} />;
    else if (name === "departures") content = <DepartureEffectsPanel canManage hotelDate={props.hotelDate} loading={false} refresh={async () => {}} setError={setError} setMessage={setMessage} />;
    else content = <LocationAudit locationId={props.locationId} />;
    return <>{content}<p data-testid="error">{error}</p><p data-testid="message">{message}</p></>;
  }
  function LocationAudit({ locationId }: { locationId: string }) { const data = useLocationAudit(locationId); return <p data-testid="audit">{JSON.stringify(data)}</p>; }
  root.render(<Screen />);
  return { props: (value: any) => setProps(value), stop: () => root.unmount() };
}
export function mountLiveRefresh() {
  let setBusy!: (value: boolean) => void;
  let setServer!: (value: string) => void;
  let server = "initial";
  let calls = 0;
  function Screen() {
    const [busy, busyState] = useState(false);
    const [value, valueState] = useState("initial");
    setBusy = busyState; setServer = value => { server = value; };
    useLiveRefresh(async () => { calls++; valueState(server); }, { busy, debounceMs: 20 });
    return <><p data-testid="value">{value}</p><p data-testid="busy">{String(busy)}</p></>;
  }
  const root = createRoot(document.getElementById("root")!); root.render(<Screen />);
  return { busy: (v: boolean) => setBusy(v), server: (v: string) => setServer(v), calls: () => calls, stop: () => root.unmount() };
}
