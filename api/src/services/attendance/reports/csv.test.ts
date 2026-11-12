// Strict assert helpers for precise test failures.
import assert from "node:assert/strict";
// Node test runner (describe/it/hooks).
import { describe, it } from "node:test";
// Prisma client enums and input types.
import { AttendanceIntervalStatus } from "@prisma/client";
// Runtime import from ./csv.
import { intervalsToCsv } from "./csv";

// Type alias CsvRow.
type CsvRow = Parameters<typeof intervalsToCsv>[0][number];

/** Independent RFC 4180-style parser (not the production escape helper). */
function parseCsv(text: string): string[][] {
  // Accumulator list rows.
  const rows: string[][] = [];
  // Accumulator list row.
  let row: string[] = [];
  // Local field used below.
  let field = "";
  // Counter i starts at 0.
  let i = 0;
  // Flag inQuotes.
  let inQuotes = false;

  // Loop until stop condition.
  while (i < text.length) {
    // Local ch used below.
    const ch = text[i]!;
    // Conditional path for this guard.
    if (inQuotes) {
      // Conditional path for this guard.
      if (ch === '"') {
        // Conditional path for this guard.
        if (text[i + 1] === '"') {
          // Assign field +.
          field += '"';
          // Assign i +.
          i += 2;
          // Continue with next iteration.
          continue;
        }
        // Assign inQuotes.
        inQuotes = false;
        // Assign i +.
        i += 1;
        // Continue with next iteration.
        continue;
      }
      // Assign field +.
      field += ch;
      // Assign i +.
      i += 1;
      // Continue with next iteration.
      continue;
    }
    // Conditional path for this guard.
    if (ch === '"') {
      // Assign inQuotes.
      inQuotes = true;
      // Assign i +.
      i += 1;
      // Continue with next iteration.
      continue;
    }
    // Conditional path for this guard.
    if (ch === ",") {
      // Support the surrounding control flow.
      row.push(field);
      // Assign field.
      field = "";
      // Assign i +.
      i += 1;
      // Continue with next iteration.
      continue;
    }
    // Conditional path for this guard.
    if (ch === "\r") {
      // Assign i +.
      i += 1;
      // Conditional path for this guard.
      if (text[i] === "\n") i += 1;
      // Support the surrounding control flow.
      row.push(field);
      // Support the surrounding control flow.
      rows.push(row);
      // Assign row.
      row = [];
      // Assign field.
      field = "";
      // Continue with next iteration.
      continue;
    }
    // Conditional path for this guard.
    if (ch === "\n") {
      // Support the surrounding control flow.
      row.push(field);
      // Support the surrounding control flow.
      rows.push(row);
      // Assign row.
      row = [];
      // Assign field.
      field = "";
      // Assign i +.
      i += 1;
      // Continue with next iteration.
      continue;
    }
    // Assign field +.
    field += ch;
    // Assign i +.
    i += 1;
  }

  // Trailing field / row (intervalsToCsv has no trailing newline)
  if (field.length > 0 || row.length > 0 || text.endsWith(",")) {
    // Support the surrounding control flow.
    row.push(field);
    // Support the surrounding control flow.
    rows.push(row);
  // Support the surrounding control flow.
  } else if (rows.length === 0 && text === "") {
    // Return computed result.
    return [];
  }

  // Return computed result.
  return rows;
}

// Internal helper fixture.
function fixture(
  // Param partial required by this function.
  partial: {
    // Param hotelDate required by this function.
    hotelDate?: string;
    // Param employeeNumber required by this function.
    employeeNumber?: string;
    // Param fullName required by this function.
    fullName?: string;
    // Param department required by this function.
    department?: string | null;
    // Param startedAt required by this function.
    startedAt?: string;
    // Param endedAt required by this function.
    endedAt?: string | null;
    // Param breakMinutes required by this function.
    breakMinutes?: number;
    // Param workedMinutes required by this function.
    workedMinutes?: number | null;
    // Param status required by this function.
    status?: AttendanceIntervalStatus;
    // Param anomalyFlags required by this function.
    anomalyFlags?: string[];
  // Support the surrounding control flow.
  } = {},
): CsvRow {
  // Return response object.
  return {
    // Field id on this type/payload.
    id: "i1",
    // Field employeeId on this type/payload.
    employeeId: "e1",
    // Field employee on this type/payload.
    employee: {
      // Field id on this type/payload.
      id: "e1",
      // Field fullName on this type/payload.
      fullName: partial.fullName ?? "Ada Lovelace",
      // Field employeeNumber on this type/payload.
      employeeNumber: partial.employeeNumber ?? "E001",
      // Field department on this type/payload.
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

// Local EXPECTED_HEADER used below.
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

// Test suite: intervalsToCsv escaping.
describe("intervalsToCsv escaping", () => {
  // Test case: keeps exactly 10 columns when department contains a comma.
  it("keeps exactly 10 columns when department contains a comma", () => {
    // Local csv used below.
    const csv = intervalsToCsv([
      // Invoke fixture.
      fixture({ department: "Reception, Night" }),
    ]);
    // Local rows used below.
    const rows = parseCsv(csv);
    // Compare scalar values.
    assert.equal(rows.length, 2);
    // Deep-compare structures.
    assert.deepEqual(rows[0], EXPECTED_HEADER);
    // Compare scalar values.
    assert.equal(rows[1]!.length, 10);
    // Compare scalar values.
    assert.equal(rows[1]![3], "Reception, Night");
  });

  // Test case: round-trips commas, quotes, and newlines in department, employeeNumber, fullName.
  it("round-trips commas, quotes, and newlines in department, employeeNumber, fullName", () => {
    // Local department used below.
    const department = 'A, "B"\nC';
    // Local employeeNumber used below.
    const employeeNumber = '12,"34"\r\n56';
    // Local fullName used below.
    const fullName = 'Doe, "Jane"\nJr';
    // Local csv used below.
    const csv = intervalsToCsv([
      // Invoke fixture.
      fixture({ department, employeeNumber, fullName }),
    ]);
    // Local rows used below.
    const rows = parseCsv(csv);
    // Compare scalar values.
    assert.equal(rows[1]!.length, 10);
    // Compare scalar values.
    assert.equal(rows[1]![1], employeeNumber);
    // Compare scalar values.
    assert.equal(rows[1]![2], fullName);
    // Compare scalar values.
    assert.equal(rows[1]![3], department);
  });

  // Test case: handles Cyrillic, empty, and null fields per export contract.
  it("handles Cyrillic, empty, and null fields per export contract", () => {
    // Local csv used below.
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
    // Local rows used below.
    const rows = parseCsv(csv);
    // Compare scalar values.
    assert.equal(rows[1]!.length, 10);
    // Compare scalar values.
    assert.equal(rows[1]![1], "");
    // Compare scalar values.
    assert.equal(rows[1]![2], "Иван Петров");
    // Compare scalar values.
    assert.equal(rows[1]![3], "");
    // Compare scalar values.
    assert.equal(rows[1]![5], "");
    // Compare scalar values.
    assert.equal(rows[1]![7], "");
  });

  // Test case: parses multiple records including a multiline field without shift.
  it("parses multiple records including a multiline field without shift", () => {
    // Local csv used below.
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
    // Local rows used below.
    const rows = parseCsv(csv);
    // Compare scalar values.
    assert.equal(rows.length, 3);
    // Iterate items for aggregation or writes.
    for (const row of rows) {
      // Compare scalar values.
      assert.equal(row.length, 10);
    }
    // Compare scalar values.
    assert.equal(rows[1]![3], "Line1\nLine2");
    // Compare scalar values.
    assert.equal(rows[1]![9], "overlap");
    // Compare scalar values.
    assert.equal(rows[2]![0], "2026-10-07");
    // Compare scalar values.
    assert.equal(rows[2]![1], "B2");
    // Compare scalar values.
    assert.equal(rows[2]![3], "Reception, Night");
    // Compare scalar values.
    assert.equal(rows[2]![9], "missing_end|absurd_duration");
  });

  // Test case: preserves ordinary record values and formats.
  it("preserves ordinary record values and formats", () => {
    // Local row used below.
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
    // Local csv used below.
    const csv = intervalsToCsv([row]);
    // Local rows used below.
    const rows = parseCsv(csv);
    // Deep-compare structures.
    assert.deepEqual(rows[0], EXPECTED_HEADER);
    // Deep-compare structures.
    assert.deepEqual(rows[1], [
      "2026-10-06",
      "E100",
      "Ada Lovelace",
      "Housekeeping",
      // Support the surrounding control flow.
      "2026-10-06T08:00:00.000Z",
      // Support the surrounding control flow.
      "2026-10-06T16:00:00.000Z",
      "30",
      "450",
      "closed",
      "overlap|large_clock_skew",
    ]);
  });
});
