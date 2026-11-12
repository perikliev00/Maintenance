/**
 * Capture SQL emitted by Prisma for a Location findMany, then EXPLAIN it.
 */
import { PrismaClient, type Prisma } from "@prisma/client";

// Export helper explainPrismaLocationFindMany for reuse across related tests.
export async function explainPrismaLocationFindMany(input: {
  // SQL fragment used to observe locks or assert DB state.
  where: Prisma.LocationWhereInput;
  // Execute the next setup or assertion step for this scenario.
  orderBy: Prisma.LocationOrderByWithRelationInput[];
  // Execute the next setup or assertion step for this scenario.
  skip: number;
  // Execute the next setup or assertion step for this scenario.
  take: number;
  // Execute the next setup or assertion step for this scenario.
  include: Prisma.LocationInclude;
// Execute the next setup or assertion step for this scenario.
}): Promise<string> {
  // Execute the next setup or assertion step for this scenario.
  const queries: Array<{ sql: string; params: string }> = [];
  // Shared Prisma client bound to the isolated test database.
  const client = new PrismaClient({
    // Execute the next setup or assertion step for this scenario.
    log: [{ emit: "event", level: "query" }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).$on("query", (e: { query: string; params: string }) => {
    // Execute the next setup or assertion step for this scenario.
    queries.push({ sql: e.query, params: e.params });
  });

  // Try path where partial failure must not leak suite state.
  try {
    // Await async work before asserting or releasing locks.
    await client.location.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: input.where,
      // Execute the next setup or assertion step for this scenario.
      include: input.include,
      // Execute the next setup or assertion step for this scenario.
      orderBy: input.orderBy,
      // Execute the next setup or assertion step for this scenario.
      skip: input.skip,
      // Execute the next setup or assertion step for this scenario.
      take: input.take,
    });

    // Bind select for later setup or assertions in this scope.
    const select = [...queries]
      // Continue the call chain for setup or assertion detail.
      .reverse()
      // Continue the call chain for setup or assertion detail.
      .find(
        // Execute the next setup or assertion step for this scenario.
        (q) =>
          // Execute the next setup or assertion step for this scenario.
          /SELECT/i.test(q.sql) &&
          // Execute the next setup or assertion step for this scenario.
          /"Location"/i.test(q.sql) &&
          // Execute the next setup or assertion step for this scenario.
          !/EXPLAIN/i.test(q.sql),
      );
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (!select) {
      // Surface a hard failure when isolation or contract is violated.
      throw new Error(
        // Execute the next setup or assertion step for this scenario.
        `no Location SELECT captured; queries=${JSON.stringify(queries)}`,
      );
    }

    // Bind params for later setup or assertions in this scope.
    const params = JSON.parse(select.params) as unknown[];
    // Bind i for later setup or assertions in this scope.
    let i = 0;
    // Bind rendered for later setup or assertions in this scope.
    const rendered = select.sql.replace(/\$\d+/g, () => {
      // Bind v for later setup or assertions in this scope.
      const v = params[i++];
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (v === null || v === undefined) return "NULL";
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (typeof v === "number") return String(v);
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
      // Return the arranged value/result to the caller.
      return `'${String(v).replace(/'/g, "''")}'`;
    });

    // rows: synchronize actors so the race window is observable.
    const rows = await client.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
      // Execute the next setup or assertion step for this scenario.
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${rendered}`,
    );
    // Return the arranged value/result to the caller.
    return rows.map((r) => r["QUERY PLAN"]).join("\n");
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Disconnect Prisma so the pool does not leak across suites.
    await client.$disconnect();
  }
}
