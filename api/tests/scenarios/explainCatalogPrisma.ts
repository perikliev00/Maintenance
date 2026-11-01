/**
 * Capture SQL emitted by Prisma for a Location findMany, then EXPLAIN it.
 */
import { PrismaClient, type Prisma } from "@prisma/client";

export async function explainPrismaLocationFindMany(input: {
  where: Prisma.LocationWhereInput;
  orderBy: Prisma.LocationOrderByWithRelationInput[];
  skip: number;
  take: number;
  include: Prisma.LocationInclude;
}): Promise<string> {
  const queries: Array<{ sql: string; params: string }> = [];
  const client = new PrismaClient({
    log: [{ emit: "event", level: "query" }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).$on("query", (e: { query: string; params: string }) => {
    queries.push({ sql: e.query, params: e.params });
  });

  try {
    await client.location.findMany({
      where: input.where,
      include: input.include,
      orderBy: input.orderBy,
      skip: input.skip,
      take: input.take,
    });

    const select = [...queries]
      .reverse()
      .find(
        (q) =>
          /SELECT/i.test(q.sql) &&
          /"Location"/i.test(q.sql) &&
          !/EXPLAIN/i.test(q.sql),
      );
    if (!select) {
      throw new Error(
        `no Location SELECT captured; queries=${JSON.stringify(queries)}`,
      );
    }

    const params = JSON.parse(select.params) as unknown[];
    let i = 0;
    const rendered = select.sql.replace(/\$\d+/g, () => {
      const v = params[i++];
      if (v === null || v === undefined) return "NULL";
      if (typeof v === "number") return String(v);
      if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
      return `'${String(v).replace(/'/g, "''")}'`;
    });

    const rows = await client.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${rendered}`,
    );
    return rows.map((r) => r["QUERY PLAN"]).join("\n");
  } finally {
    await client.$disconnect();
  }
}
