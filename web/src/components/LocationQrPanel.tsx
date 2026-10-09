import {
  roomQrImageUrl,
  roomQrScanUrl,
  type Room,
} from "../api/client";

type Props = {
  label: (bg: string, en: string) => string;
  rooms: Room[];
  filter: string;
  preview: Room | null;
  onFilterChange: (value: string) => void;
  onPreviewChange: (room: Room | null) => void;
};

export function LocationQrPanel({
  label,
  rooms,
  filter,
  preview,
  onFilterChange,
  onPreviewChange,
}: Props) {
  const q = filter.trim().toLowerCase();
  const qrRooms = !q
    ? rooms
    : rooms.filter(
        (r) =>
          r.number.toLowerCase().includes(q) ||
          r.buildingCode.toLowerCase().includes(q) ||
          (r.sector?.code.toLowerCase().includes(q) ?? false),
      );

  return (
    <section className="panel">
      <h2>{label("QR кодове", "QR codes")}</h2>
      <p className="muted">
        {label(
          "Генериране и печат на QR за помещения. Сканирането само идентифицира стаята — без автоматичен start/complete. (Invite QR за устройства е в Екип.)",
          "Generate and print room QR codes. Scanning only identifies the room — no auto start/complete. (Device invite QR lives under Team.)",
        )}
      </p>
      <label className="inline-search">
        {label("Филтър…", "Filter…")}
        <input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={label("номер / сграда", "number / building")}
        />
      </label>
      {preview && (
        <div className="qr-print-card" style={{ margin: "1rem 0" }}>
          <h3>
            {preview.buildingCode} {preview.number}
          </h3>
          <img
            src={roomQrImageUrl(roomQrScanUrl(preview.qrToken!), 220)}
            alt={`QR ${preview.number}`}
            width={220}
            height={220}
          />
          <p className="muted small">{roomQrScanUrl(preview.qrToken!)}</p>
          <div className="row-actions">
            <button type="button" onClick={() => window.print()}>
              {label("Печат", "Print")}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => onPreviewChange(null)}
            >
              {label("Затвори", "Close")}
            </button>
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{label("Помещение", "Location")}</th>
              <th>{label("Сектор", "Sector")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {qrRooms.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>
                    {r.buildingCode} {r.number}
                  </strong>
                  <div className="muted small">
                    ет. {r.floor} ·{" "}
                    {r.kind === "common_area" ? "common" : "room"}
                  </div>
                </td>
                <td>{r.sector?.code ?? "—"}</td>
                <td>
                  <button
                    type="button"
                    className="ghost"
                    disabled={!r.qrToken}
                    onClick={() => onPreviewChange(r)}
                  >
                    {label("QR", "QR")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
