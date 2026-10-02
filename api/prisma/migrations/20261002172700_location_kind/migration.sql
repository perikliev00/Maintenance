-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('room', 'common_area');

-- AlterTable
ALTER TABLE "Location" ADD COLUMN "kind" "LocationKind" NOT NULL DEFAULT 'room';

-- CreateIndex
CREATE INDEX "Location_kind_catalogStatus_idx" ON "Location"("kind", "catalogStatus");
