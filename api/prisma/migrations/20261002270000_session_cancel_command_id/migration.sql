-- AlterTable
ALTER TABLE "CleaningSession" ADD COLUMN "cancelCommandId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CleaningSession_cancelCommandId_key" ON "CleaningSession"("cancelCommandId");
