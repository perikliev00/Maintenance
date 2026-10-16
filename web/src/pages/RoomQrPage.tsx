/**
 * Resolve a scanned location QR token to status display only —
 * does not start or complete cleaning.
 */
import { useEffect, useState } from "react";
import {
  resolveLocationByQr,
  type AuthUser,
  type Room,
  type LocationQrPayload,
} from "../api/client";

type Props = {
  user: AuthUser;
  token: string;
  onClose: () => void;
};

/**
 * Status-only view after scanning a location QR token.
 * Resolves the token to location + QR payload; never starts/completes cleaning.
 */
export function RoomQrPage({ token, onClose }: Props) {
  // True until the QR resolve settles (success or error).
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Location board row returned by the resolve API.
  const [location, setLocation] = useState<Room | null>(null);
  // Parsed QR identity fields (building, number, floor, token).
  const [qr, setQr] = useState<LocationQrPayload | null>(null);

  // Resolve token whenever it changes; ignore late responses after unmount/retoken.
  useEffect(() => {
    let cancelled = false;
    // Enter loading and clear prior error/result for the new token.
    setLoading(true);
    // State transition.
    setError(null);
    // Fire-and-forget async call.
    void resolveLocationByQr(token)
      // Promise then handler.
      .then((res) => {
        // Drop stale responses if the token changed or the page unmounted.
        if (cancelled) return;
        // State transition.
        setLocation(res.location);
        // State transition.
        setQr(res.qr);
      })
      // Promise catch handler.
      .catch((err) => {
        // Branch: conditional gate.
        if (cancelled) return;
        // State transition.
        setError(err instanceof Error ? err.message : "QR resolve failed");
      })
      .finally(() => {
        // Branch: conditional gate.
        if (!cancelled) setLoading(false);
      });
    // Early / value return.
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Early / value return.
  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>QR помещение</h1>
          <p className="muted">
            Идентификация на помещение — без автоматично начало/край на
            почистване
          </p>
        </div>
        {/* Close returns to the previous shell panel. */}
        <button type="button" className="ghost" onClick={onClose}>
          Затвори
        </button>
      </header>

      {/* Loading / error gates before identity panel. */}
      {loading && <p className="muted">Зареждане…</p>}
      {/* Render branch: error && <div className="error banner">error</div> */}
      {error && <div className="error banner">{error}</div>}

      {/* Show identity + live status only after both location and QR resolve. */}
      {location && qr && (
        <section className="panel">
          <h2>
            {qr.buildingCode} {qr.number}
          </h2>
          <p className="muted">
            {/* Kind label: common area vs guest room. */}
            {location.kind === "common_area" ? "Обща част" : "Стая"} · ет.{" "}
            {qr.floor} · {location.building}
          </p>
          <dl className="kv">
            <div>
              <dt>Почистване</dt>
              <dd>{location.cleaningStatus}</dd>
            </div>
            <div>
              <dt>Заетост</dt>
              <dd>{location.occupancy}</dd>
            </div>
            <div>
              <dt>Готовност</dt>
              <dd>{location.readiness}</dd>
            </div>
            {/* Sector is optional on some locations. */}
            {location.sector && (
              <div>
                <dt>Сектор</dt>
                <dd>{location.sector.code}</dd>
              </div>
            )}
            {/* Active task is informational — no claim/start actions here. */}
            {location.activeTask && (
              <div>
                <dt>Активна задача</dt>
                <dd>
                  {location.activeTask.status}
                  {/* Assignee name when the task is claimed. */}
                  {location.activeTask.assignee
                    ? ` · ${location.activeTask.assignee.fullName}`
                    : ""}
                </dd>
              </div>
            )}
          </dl>
          <p className="muted small">
            Токен: <code>{qr.qrToken}</code>
          </p>
        </section>
      )}
    </main>
  );
}
