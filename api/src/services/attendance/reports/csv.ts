import { mapInterval } from "./map";

/** Quote a CSV cell when it contains comma, quote, CR, or LF (doubling internal quotes). */
function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function intervalsToCsv(
  rows: ReturnType<typeof mapInterval>[],
): string {
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
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.hotelDate,
      r.employee.employeeNumber,
      r.employee.fullName,
      r.employee.department ?? "",
      r.startedAt,
      r.endedAt ?? "",
      String(r.breakMinutes),
      r.workedMinutes == null ? "" : String(r.workedMinutes),
      r.status,
      r.anomalyFlags.join("|"),
    ].map(escapeCsvCell);
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}
