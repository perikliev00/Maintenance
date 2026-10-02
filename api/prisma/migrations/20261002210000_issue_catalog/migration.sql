-- CreateEnum
CREATE TYPE "IssueOptionKind" AS ENUM ('maintenance', 'housekeeping');

-- CreateTable
CREATE TABLE "MaintenanceCategory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameBg" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueOption" (
    "id" TEXT NOT NULL,
    "maintenanceCategoryId" TEXT NOT NULL,
    "kind" "IssueOptionKind" NOT NULL,
    "nameBg" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "defaultPriority" "Priority",
    "defaultBlocksRoom" BOOLEAN,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueOption_pkey" PRIMARY KEY ("id")
);

-- Seed default categories (stable keys for backfill)
INSERT INTO "MaintenanceCategory" ("id", "key", "nameBg", "nameEn", "sortOrder", "isActive", "updatedAt") VALUES
('mc_climate', 'climate', 'Климат', 'Climate', 0, true, CURRENT_TIMESTAMP),
('mc_electrical', 'electrical', 'Ел.', 'Electrical', 1, true, CURRENT_TIMESTAMP),
('mc_furniture', 'furniture', 'Мебели', 'Furniture', 2, true, CURRENT_TIMESTAMP),
('mc_plumbing', 'plumbing', 'ВиК', 'Plumbing', 3, true, CURRENT_TIMESTAMP),
('mc_other', 'other', 'Друго', 'Other', 4, true, CURRENT_TIMESTAMP);

-- AlterTable MaintenanceTicket: add new columns
ALTER TABLE "MaintenanceTicket" ADD COLUMN "issueOptionId" TEXT;
ALTER TABLE "MaintenanceTicket" ADD COLUMN "maintenanceCategoryId" TEXT;
ALTER TABLE "MaintenanceTicket" ADD COLUMN "categoryKey" TEXT;
ALTER TABLE "MaintenanceTicket" ADD COLUMN "categoryLabelBg" TEXT;
ALTER TABLE "MaintenanceTicket" ADD COLUMN "categoryLabelEn" TEXT;

-- Backfill snapshots from legacy enum column
UPDATE "MaintenanceTicket" AS mt SET
  "categoryKey" = mt."category"::text,
  "categoryLabelBg" = CASE mt."category"::text
    WHEN 'climate' THEN 'Климат'
    WHEN 'electrical' THEN 'Ел.'
    WHEN 'furniture' THEN 'Мебели'
    WHEN 'plumbing' THEN 'ВиК'
    WHEN 'other' THEN 'Друго'
    ELSE mt."category"::text
  END,
  "categoryLabelEn" = CASE mt."category"::text
    WHEN 'climate' THEN 'Climate'
    WHEN 'electrical' THEN 'Electrical'
    WHEN 'furniture' THEN 'Furniture'
    WHEN 'plumbing' THEN 'Plumbing'
    WHEN 'other' THEN 'Other'
    ELSE mt."category"::text
  END,
  "maintenanceCategoryId" = mc."id"
FROM "MaintenanceCategory" AS mc
WHERE mc."key" = mt."category"::text;

ALTER TABLE "MaintenanceTicket" ALTER COLUMN "categoryKey" SET NOT NULL;
ALTER TABLE "MaintenanceTicket" ALTER COLUMN "categoryLabelBg" SET NOT NULL;
ALTER TABLE "MaintenanceTicket" ALTER COLUMN "categoryLabelEn" SET NOT NULL;

ALTER TABLE "MaintenanceTicket" DROP COLUMN "category";

DROP TYPE "TicketCategory";

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceCategory_key_key" ON "MaintenanceCategory"("key");

CREATE INDEX "IssueOption_maintenanceCategoryId_isActive_sortOrder_idx" ON "IssueOption"("maintenanceCategoryId", "isActive", "sortOrder");

CREATE INDEX "MaintenanceTicket_categoryKey_idx" ON "MaintenanceTicket"("categoryKey");

-- AddForeignKey
ALTER TABLE "IssueOption" ADD CONSTRAINT "IssueOption_maintenanceCategoryId_fkey" FOREIGN KEY ("maintenanceCategoryId") REFERENCES "MaintenanceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_issueOptionId_fkey" FOREIGN KEY ("issueOptionId") REFERENCES "IssueOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_maintenanceCategoryId_fkey" FOREIGN KEY ("maintenanceCategoryId") REFERENCES "MaintenanceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
