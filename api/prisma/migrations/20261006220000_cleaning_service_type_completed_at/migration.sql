-- CreateEnum
CREATE TYPE "CleaningServiceType" AS ENUM ('stayover', 'departure', 'arrival', 'common_area');

-- AlterTable
ALTER TABLE "CleaningTask" ADD COLUMN "serviceType" "CleaningServiceType" NOT NULL DEFAULT 'stayover';
ALTER TABLE "CleaningTask" ADD COLUMN "completedAt" TIMESTAMP(3);

-- Backfill serviceType from location kind + linked daily plan category
UPDATE "CleaningTask" AS ct
SET "serviceType" = CASE
  WHEN loc.kind IS DISTINCT FROM 'room' THEN 'common_area'::"CleaningServiceType"
  WHEN (
    SELECT dpe0.category
    FROM "DailyPlanEntry" AS dpe0
    WHERE dpe0."cleaningTaskId" = ct.id
    ORDER BY
      CASE dpe0.category
        WHEN 'departure' THEN 1
        WHEN 'arrival' THEN 2
        ELSE 3
      END,
      dpe0."createdAt" ASC
    LIMIT 1
  ) = 'departure' THEN 'departure'::"CleaningServiceType"
  WHEN (
    SELECT dpe0.category
    FROM "DailyPlanEntry" AS dpe0
    WHERE dpe0."cleaningTaskId" = ct.id
    ORDER BY
      CASE dpe0.category
        WHEN 'departure' THEN 1
        WHEN 'arrival' THEN 2
        ELSE 3
      END,
      dpe0."createdAt" ASC
    LIMIT 1
  ) = 'arrival' THEN 'arrival'::"CleaningServiceType"
  ELSE 'stayover'::"CleaningServiceType"
END
FROM "Location" AS loc
WHERE ct."locationId" = loc.id;

-- Backfill completedAt for completed tasks
UPDATE "CleaningTask" AS ct
SET "completedAt" = COALESCE(
  (
    SELECT i."inspectedAt"
    FROM "Inspection" AS i
    WHERE i."taskId" = ct.id
      AND i.result = 'approved'
    ORDER BY i."inspectedAt" DESC
    LIMIT 1
  ),
  (
    SELECT s."finishedAt"
    FROM "CleaningSession" AS s
    WHERE s."taskId" = ct.id
      AND s.status = 'completed'
      AND s."finishedAt" IS NOT NULL
    ORDER BY s."finishedAt" DESC
    LIMIT 1
  ),
  ct."updatedAt"
)
WHERE ct.status = 'completed'
  AND ct."completedAt" IS NULL;

-- CreateIndex
CREATE INDEX "CleaningTask_completedAt_status_idx" ON "CleaningTask"("completedAt", "status");

-- CreateIndex
CREATE INDEX "CleaningTask_serviceType_completedAt_idx" ON "CleaningTask"("serviceType", "completedAt");
