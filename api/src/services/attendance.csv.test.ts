import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AttendanceIntervalStatus } from "@prisma/client";
import { intervalsToCsv } from "./attendance";

type CsvRow = Parameters<typeof intervalsToCsv>[0][number];

/** Independent RFC 4180-style parser (not the production escape helper). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      if (text[i] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Trailing field / row (intervalsToCsv has no trailing newline)
  if (field.length > 0 || row.length > 0 || text.endsWith(",")) {
    row.push(field);
    rows.push(row);
  } else if (rows.length === 0 && text === "") {
    return [];
  }

  return rows;
}

function fixture(
  partial: {
    hotelDate?: string;
    employeeNumber?: string;
    fullName?: string;
    department?: string | null;
    startedAt?: string;
    endedAt?: string | null;
    breakMinutes?: number;
    workedMinutes?: number | null;
    status?: AttendanceIntervalStatus;
    anomalyFlags?: string[];
  } = {},
): CsvRow {
  return {
    id: "i1",
    employeeId: "e1",
    employee: {
      id: "e1",
      fullName: partial.fullName ?? "Ada Lovelace",
      employeeNumber: partial.employeeNumber ?? "E001",
      department: partial.department === undefined ? "Housekeeping" : partial.department,
    },
    hotelDate: partial.hotelDate ?? "2026-10-06",
    startedAt: partial.startedAt ?? "2026-10-06T08:00:00.000Z",
    endedAt: partial.endedAt === undefined ? "2026-10-06T16:00:00.000Z" : partial.endedAt,
    breakMinutes: partial.breakMinutes ?? 30,
    workedMinutes: partial.workedMinutes === undefined ? 450 : partial.workedMinutes,
    status: partial.status ?? AttendanceIntervalStatus.closed,
    anomalyFlags: (partial.anomalyFlags ?? []) as CsvRow["anomalyFlags"],
    startEventId: "s1",
    endEventId: "e1",
    adjustments: [],
    createdAt: "2026-10-06T08:00:00.000Z",
    updatedAt: "2026-10-06T16:00:00.000Z",
  };
}

const EXPECTED_HEADER = [
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
];

describe("intervalsToCsv escaping", () => {
  it("keeps exactly 10 columns when department contains a comma", () => {
    const csv = intervalsToCsv([
      fixture({ department: "Reception, Night" }),
    ]);
    const rows = parseCsv(csv);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], EXPECTED_HEADER);
    assert.equal(rows[1]!.length, 10);
    assert.equal(rows[1]![3], "Reception, Night");
  });

  it("round-trips commas, quotes, and newlines in department, employeeNumber, fullName", () => {
    const department = 'A, "B"\nC';
    const employeeNumber = '12,"34"\r\n56';
    const fullName = 'Doe, "Jane"\nJr';
    const csv = intervalsToCsv([
      fixture({ department, employeeNumber, fullName }),
    ]);
    const rows = parseCsv(csv);
    assert.equal(rows[1]!.length, 10);
    assert.equal(rows[1]![1], employeeNumber);
    assert.equal(rows[1]![2], fullName);
    assert.equal(rows[1]![3], department);
  });

  it("handles Cyrillic, empty, and null fields per export contract", () => {
    const csv = intervalsToCsv([
      fixture({
        fullName: "Иван Петров",
        department: null,
        endedAt: null,
        workedMinutes: null,
        employeeNumber: "",
      }),
    ]);
    const rows = parseCsv(csv);
    assert.equal(rows[1]!.length, 10);
    assert.equal(rows[1]![1], "");
    assert.equal(rows[1]![2], "Иван Петров");
    assert.equal(rows[1]![3], "");
    assert.equal(rows[1]![5], "");
    assert.equal(rows[1]![7], "");
  });

  it("parses multiple records including a multiline field without shift", () => {
    const csv = intervalsToCsv([
      fixture({
        employeeNumber: "A1",
        fullName: "First",
        department: "Line1\nLine2",
        anomalyFlags: ["overlap"],
      }),
      fixture({
        employeeNumber: "B2",
        fullName: "Second",
        department: "Reception, Night",
        hotelDate: "2026-10-07",
        startedAt: "2026-10-07T09:00:00.000Z",
        endedAt: "2026-10-07T17:00:00.000Z",
        breakMinutes: 0,
        workedMinutes: 480,
        status: AttendanceIntervalStatus.open,
        anomalyFlags: ["missing_end", "absurd_duration"],
      }),
    ]);
    const rows = parseCsv(csv);
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.length, 10);
    }
    assert.equal(rows[1]![3], "Line1\nLine2");
    assert.equal(rows[1]![9], "overlap");
    assert.equal(rows[2]![0], "2026-10-07");
    assert.equal(rows[2]![1], "B2");
    assert.equal(rows[2]![3], "Reception, Night");
    assert.equal(rows[2]![9], "missing_end|absurd_duration");
  });

  it("preserves ordinary record values and formats", () => {
    const row = fixture({
      hotelDate: "2026-10-06",
      employeeNumber: "E100",
      fullName: "Ada Lovelace",
      department: "Housekeeping",
      startedAt: "2026-10-06T08:00:00.000Z",
      endedAt: "2026-10-06T16:00:00.000Z",
      breakMinutes: 30,
      workedMinutes: 450,
      status: AttendanceIntervalStatus.closed,
      anomalyFlags: ["overlap", "large_clock_skew"],
    });
    const csv = intervalsToCsv([row]);
    const rows = parseCsv(csv);
    assert.deepEqual(rows[0], EXPECTED_HEADER);
    assert.deepEqual(rows[1], [
      "2026-10-06",
      "E100",
      "Ada Lovelace",
      "Housekeeping",
      "2026-10-06T08:00:00.000Z",
      "2026-10-06T16:00:00.000Z",
      "30",
      "450",
      "closed",
      "overlap|large_clock_skew",
    ]);
  });
});
