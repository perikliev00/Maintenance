/**
 * Serialize mapped attendance intervals to a CSV string for download export.
 */
import { mapInterval } from "./map";

/** Quote a CSV cell when it contains comma, quote, CR, or LF (doubling internal quotes). */
function escapeCsvCell(value: string): string {
  // RFC-style quoting: wrap and double any embedded quotes.
  if (/[",\r\n]/.test(value)) {
    // Return computed result.
    return `"${value.replace(/"/g, '""')}"`;
  }
  // Plain cell — safe without quotes.
  return value;
}

/** Build a CSV document (header + rows); anomaly flags joined with `|`. */
export function intervalsToCsv(
  // Param rows required by this function.
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
  // Support the surrounding control flow.
  ].map(escapeCsvCell);
  // First line is the header row.
  const lines = [header.join(",")];
  // Iterate items for aggregation or writes.
  for (const r of rows) {
    // Null endedAt / workedMinutes become empty cells; flags pipe-joined.
    const cells = [
      // Support the surrounding control flow.
      r.hotelDate,
      // Support the surrounding control flow.
      r.employee.employeeNumber,
      // Support the surrounding control flow.
      r.employee.fullName,
      // Support the surrounding control flow.
      r.employee.department ?? "",
      // Support the surrounding control flow.
      r.startedAt,
      // Support the surrounding control flow.
      r.endedAt ?? "",
      // Invoke String.
      String(r.breakMinutes),
      // Assign r.workedMinutes.
      r.workedMinutes == null ? "" : String(r.workedMinutes),
      // Support the surrounding control flow.
      r.status,
      // Support the surrounding control flow.
      r.anomalyFlags.join("|"),
    // Support the surrounding control flow.
    ].map(escapeCsvCell);
    // Support the surrounding control flow.
    lines.push(cells.join(","));
  }
  // LF-separated document (spreadsheet-friendly).
  return lines.join("\n");
}
