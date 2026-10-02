-- AlterTable
ALTER TABLE "User" ADD COLUMN "activatedAt" TIMESTAMP(3);

-- Backfill existing users as already activated
UPDATE "User" SET "activatedAt" = "createdAt" WHERE "activatedAt" IS NULL;

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('issued', 'consumed', 'expired', 'revoked');

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeHint" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "email" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'issued',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedDeviceId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Device_userId_revokedAt_idx" ON "Device"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Device_employeeId_revokedAt_idx" ON "Device"("employeeId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_codeHash_key" ON "Invitation"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_consumedDeviceId_key" ON "Invitation"("consumedDeviceId");

-- CreateIndex
CREATE INDEX "Invitation_status_expiresAt_idx" ON "Invitation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Invitation_employeeId_status_idx" ON "Invitation"("employeeId", "status");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_consumedDeviceId_fkey" FOREIGN KEY ("consumedDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
