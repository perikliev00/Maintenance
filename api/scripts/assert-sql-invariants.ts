/**
 * Assert cleaning partial unique indexes and TicketEvent.commandId unique
 * exist with the exact PostgreSQL 16 catalog shape after migrate deploy.
 *
 * Expected predicates were measured on Postgres 16 (pg_get_expr) after
 * applying the repo migrations — not copied from migration SQL substrings.
 *
 * Requires DATABASE_URL. Read-only. Does not need seed.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type IndexExpectation = {
  indexName: string;
  tableName: string;
  keyColumns: string[];
  /** Exact pg_get_expr(indpred, indrelid); null = no partial predicate. */
  predicate: string | null;
};

/**
 * Measured on PostgreSQL 16 after `prisma migrate deploy` (2026-10-10).
 * CleaningTask IN (...) is stored as ANY (ARRAY[...]) with TaskStatus casts.
 */
const EXPECTED: IndexExpectation[] = [
  {
    indexName: "CleaningSession_one_running_per_task",
    tableName: "CleaningSession",
    keyColumns: ["taskId"],
    predicate: `(status = 'running'::"SessionStatus")`,
  },
  {
    indexName: "CleaningSession_one_running_per_employee",
    tableName: "CleaningSession",
    keyColumns: ["employeeId"],
    predicate: `(status = 'running'::"SessionStatus")`,
  },
  {
    indexName: "CleaningTask_one_active_per_room_date",
    tableName: "CleaningTask",
    keyColumns: ["locationId", "hotelDate"],
    predicate: `(status = ANY (ARRAY['assigned'::"TaskStatus", 'in_progress'::"TaskStatus", 'awaiting_inspection'::"TaskStatus", 'rework'::"TaskStatus"]))`,
  },
  {
    indexName: "TicketEvent_commandId_key",
    tableName: "TicketEvent",
    keyColumns: ["commandId"],
    predicate: null,
  },
];

type CatalogRow = {
  schema_name: string;
  table_name: string;
  index_name: string;
  indisunique: boolean;
  indisvalid: boolean;
  indisready: boolean;
  predicate: string | null;
  key_columns: string[];
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function loadIndexes(): Promise<Map<string, CatalogRow>> {
  const rows = await prisma.$queryRaw<CatalogRow[]>`
    SELECT
      n.nspname AS schema_name,
      t.relname AS table_name,
      i.relname AS index_name,
      ix.indisunique,
      ix.indisvalid,
      ix.indisready,
      pg_get_expr(ix.indpred, ix.indrelid) AS predicate,
      (
        SELECT array_agg(a.attname ORDER BY x.ordinality)
        FROM unnest(ix.indkey) WITH ORDINALITY AS x(attnum, ordinality)
        JOIN pg_attribute a
          ON a.attrelid = ix.indrelid AND a.attnum = x.attnum
      ) AS key_columns
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND i.relname IN (
        'CleaningSession_one_running_per_task',
        'CleaningSession_one_running_per_employee',
        'CleaningTask_one_active_per_room_date',
        'TicketEvent_commandId_key'
      )
  `;

  const map = new Map<string, CatalogRow>();
  for (const row of rows) {
    map.set(row.index_name, {
      ...row,
      key_columns: Array.isArray(row.key_columns) ? row.key_columns : [],
    });
  }
  return map;
}

async function main() {
  assert(process.env.DATABASE_URL, "DATABASE_URL required");

  const found = await loadIndexes();
  const errors: string[] = [];

  for (const exp of EXPECTED) {
    const row = found.get(exp.indexName);
    if (!row) {
      errors.push(`missing index ${exp.indexName}`);
      continue;
    }
    if (row.schema_name !== "public") {
      errors.push(`${exp.indexName}: schema ${row.schema_name} !== public`);
    }
    if (row.table_name !== exp.tableName) {
      errors.push(
        `${exp.indexName}: table ${row.table_name} !== ${exp.tableName}`,
      );
    }
    if (!row.indisunique) {
      errors.push(`${exp.indexName}: indisunique is false`);
    }
    if (!row.indisvalid) {
      errors.push(`${exp.indexName}: indisvalid is false`);
    }
    if (!row.indisready) {
      errors.push(`${exp.indexName}: indisready is false`);
    }
    if (!sameStringArray(row.key_columns, exp.keyColumns)) {
      errors.push(
        `${exp.indexName}: key columns [${row.key_columns.join(",")}] !== [${exp.keyColumns.join(",")}]`,
      );
    }
    if (exp.predicate === null) {
      if (row.predicate != null) {
        errors.push(
          `${exp.indexName}: expected no predicate, got ${JSON.stringify(row.predicate)}`,
        );
      }
    } else if (row.predicate !== exp.predicate) {
      errors.push(
        `${exp.indexName}: predicate ${JSON.stringify(row.predicate)} !== ${JSON.stringify(exp.predicate)}`,
      );
    }
  }

  if (errors.length) {
    throw new Error(
      `SQL invariants failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  console.log("assert-sql-invariants: ok");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
