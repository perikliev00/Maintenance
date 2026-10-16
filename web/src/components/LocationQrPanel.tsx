/**
 * List + print preview for location QR codes.
 * Scanning only identifies the room (no auto start/complete); rows without
 * `qrToken` cannot open a preview.
 */
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

/**
 * Presentational panel: filterable location QR list with print preview.
 * Scanning only identifies the room — no auto start/complete.
 */
export function LocationQrPanel({
  label,
  rooms,
  filter,
  preview,
  onFilterChange,
  onPreviewChange,
}: Props) {
  // Normalize filter for case-insensitive substring match.
  const q = filter.trim().toLowerCase();
  // Empty filter → full list; otherwise match number / building / sector code.
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
      {/* Client-side filter input (does not hit the network). */}
      <label className="inline-search">
        {label("Филтър…", "Filter…")}
        <input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={label("номер / сграда", "number / building")}
        />
      </label>
      {/* Print preview card — only when a row with qrToken was selected. */}
      {preview && (
        <div className="qr-print-card" style={{ margin: "1rem 0" }}>
          <h3>
            {preview.buildingCode} {preview.number}
          </h3>
          {/* External QR image from the scan URL; token is required here. */}
          <img
            src={roomQrImageUrl(roomQrScanUrl(preview.qrToken!), 220)}
            alt={`QR ${preview.number}`}
            width={220}
            height={220}
          />
          <p className="muted small">{roomQrScanUrl(preview.qrToken!)}</p>
          <div className="row-actions">
            {/* Browser print dialog for the preview card. */}
            <button type="button" onClick={() => window.print()}>
              {label("Печат", "Print")}
            </button>
            {/* Clear preview selection. */}
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
                    {/* Kind label for common areas vs guest rooms. */}
                    {r.kind === "common_area" ? "common" : "room"}
                  </div>
                </td>
                <td>{r.sector?.code ?? "—"}</td>
                <td>
                  {/* Disabled when the location has no qrToken yet. */}
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
