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

export function RoomQrPage({ token, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<Room | null>(null);
  const [qr, setQr] = useState<LocationQrPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void resolveLocationByQr(token)
      .then((res) => {
        if (cancelled) return;
        setLocation(res.location);
        setQr(res.qr);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "QR resolve failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

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
        <button type="button" className="ghost" onClick={onClose}>
          Затвори
        </button>
      </header>

      {loading && <p className="muted">Зареждане…</p>}
      {error && <div className="error banner">{error}</div>}

      {location && qr && (
        <section className="panel">
          <h2>
            {qr.buildingCode} {qr.number}
          </h2>
          <p className="muted">
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
            {location.sector && (
              <div>
                <dt>Сектор</dt>
                <dd>{location.sector.code}</dd>
              </div>
            )}
            {location.activeTask && (
              <div>
                <dt>Активна задача</dt>
                <dd>
                  {location.activeTask.status}
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
