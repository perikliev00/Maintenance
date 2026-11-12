import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AttendanceIntervalStatus } from "@prisma/client";
import { intervalsToCsv } from "./csv";

// Type alias CsvRow.
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
          // Assign field +.
          field += '"';
          // Assign i +.
          i += 2;
          continue;
        }
        // Assign inQuotes.
        inQuotes = false;
        // Assign i +.
        i += 1;
        continue;
      }
      // Assign field +.
      field += ch;
      // Assign i +.
      i += 1;
      continue;
    }
    if (ch === '"') {
      // Assign inQuotes.
      inQuotes = true;
      // Assign i +.
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      // Assign field.
      field = "";
      // Assign i +.
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // Assign i +.
      i += 1;
      if (text[i] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      // Assign row.
      row = [];
      // Assign field.
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      // Assign row.
      row = [];
      // Assign field.
      field = "";
      // Assign i +.
      i += 1;
      continue;
    }
    // Assign field +.
    field += ch;
    // Assign i +.
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
    // Compute hotelDate for the payload.
    hotelDate: partial.hotelDate ?? "2026-10-06",
    // Set startedAt.
    startedAt: partial.startedAt ?? "2026-10-06T08:00:00.000Z",
    // Set endedAt.
    endedAt: partial.endedAt === undefined ? "2026-10-06T16:00:00.000Z" : partial.endedAt,
    // Set breakMinutes.
    breakMinutes: partial.breakMinutes ?? 30,
    // Set workedMinutes.
    workedMinutes: partial.workedMinutes === undefined ? 450 : partial.workedMinutes,
    // Set status.
    status: partial.status ?? AttendanceIntervalStatus.closed,
    // Set anomalyFlags.
    anomalyFlags: (partial.anomalyFlags ?? []) as CsvRow["anomalyFlags"],
    // Set startEventId.
    startEventId: "s1",
    // Set endEventId.
    endEventId: "e1",
    // Set adjustments.
    adjustments: [],
    // Set createdAt.
    createdAt: "2026-10-06T08:00:00.000Z",
    // Set updatedAt.
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
      // Invoke fixture.
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
      // Invoke fixture.
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
      // Invoke fixture.
      fixture({
        // Set fullName.
        fullName: "Иван Петров",
        // Set department.
        department: null,
        // Set endedAt.
        endedAt: null,
        // Set workedMinutes.
        workedMinutes: null,
        // Set employeeNumber.
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
      // Invoke fixture.
      fixture({
        // Set employeeNumber.
        employeeNumber: "A1",
        // Set fullName.
        fullName: "First",
        // Set department.
        department: "Line1\nLine2",
        // Set anomalyFlags.
        anomalyFlags: ["overlap"],
      }),
      // Invoke fixture.
      fixture({
        // Set employeeNumber.
        employeeNumber: "B2",
        // Set fullName.
        fullName: "Second",
        // Set department.
        department: "Reception, Night",
        // Compute hotelDate for the payload.
        hotelDate: "2026-10-07",
        // Set startedAt.
        startedAt: "2026-10-07T09:00:00.000Z",
        // Set endedAt.
        endedAt: "2026-10-07T17:00:00.000Z",
        // Set breakMinutes.
        breakMinutes: 0,
        // Set workedMinutes.
        workedMinutes: 480,
        // Set status.
        status: AttendanceIntervalStatus.open,
        // Set anomalyFlags.
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
      // Compute hotelDate for the payload.
      hotelDate: "2026-10-06",
      // Set employeeNumber.
      employeeNumber: "E100",
      // Set fullName.
      fullName: "Ada Lovelace",
      // Set department.
      department: "Housekeeping",
      // Set startedAt.
      startedAt: "2026-10-06T08:00:00.000Z",
      // Set endedAt.
      endedAt: "2026-10-06T16:00:00.000Z",
      // Set breakMinutes.
      breakMinutes: 30,
      // Set workedMinutes.
      workedMinutes: 450,
      // Set status.
      status: AttendanceIntervalStatus.closed,
      // Set anomalyFlags.
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
