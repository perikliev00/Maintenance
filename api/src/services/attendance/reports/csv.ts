/**
 * Serialize mapped attendance intervals to a CSV string for download export.
 */
import { mapInterval } from "./map";

/** Quote a CSV cell when it contains comma, quote, CR, or LF (doubling internal quotes). */
function escapeCsvCell(value: string): string {
  // RFC-style quoting: wrap and double any embedded quotes.
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  // Plain cell — safe without quotes.
  return value;
}

/** Build a CSV document (header + rows); anomaly flags joined with `|`. */
export function intervalsToCsv(
  rows: ReturnType<typeof mapInterval>[],
): string {
  // Stable column order for spreadsheet imports.
  const header = [
    "hotelDate",
    "employeeNumber",
    "fullName",
    "department",
    "startedAt",
    "endedAt",
    "breakMinutes",
    "workedMinutes",
    "status",
    "anomalyFlags",
  ].map(escapeCsvCell);
  // First line is the header row.
  const lines = [header.join(",")];
  for (const r of rows) {
    // Null endedAt / workedMinutes become empty cells; flags pipe-joined.
    const cells = [
      r.hotelDate,
      r.employee.employeeNumber,
      r.employee.fullName,
      r.employee.department ?? "",
      r.startedAt,
      r.endedAt ?? "",
      // Invoke String.
      String(r.breakMinutes),
      // Assign r.workedMinutes.
      r.workedMinutes == null ? "" : String(r.workedMinutes),
      r.status,
      r.anomalyFlags.join("|"),
    ].map(escapeCsvCell);
    lines.push(cells.join(","));
  }
  // LF-separated document (spreadsheet-friendly).
  return lines.join("\n");
}
