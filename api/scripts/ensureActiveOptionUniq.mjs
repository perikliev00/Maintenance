/**
 * Ensure MaintenanceTicket_active_option_uniq exists when data is clean.
 * Safe to re-run; skips with a message if active duplicates remain.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const dups = await prisma.$queryRawUnsafe(`
  SELECT "locationId", "issueOptionId", COUNT(*)::int AS n
  FROM "MaintenanceTicket"
  WHERE "issueOptionId" IS NOT NULL
    AND "status" IN ('new', 'assigned', 'in_progress', 'waiting')
  GROUP BY "locationId", "issueOptionId"
  HAVING COUNT(*) > 1
  LIMIT 5
`);

if (Array.isArray(dups) && dups.length > 0) {
  console.log("Active duplicates present; skipping unique index:", dups);
} else {
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "MaintenanceTicket_active_option_uniq"
      ON "MaintenanceTicket" ("locationId", "issueOptionId")
      WHERE "issueOptionId" IS NOT NULL
        AND "status" IN ('new', 'assigned', 'in_progress', 'waiting')
  `);
  console.log("MaintenanceTicket_active_option_uniq ensured");
}

const indexes = await prisma.$queryRawUnsafe(`
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'MaintenanceTicket'
  ORDER BY 1
`);
console.log(indexes);
await prisma.$disconnect();
