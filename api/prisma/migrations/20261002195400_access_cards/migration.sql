-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('guest', 'housekeeper', 'maintenance', 'manager', 'master');

-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('active', 'revoked');

-- CreateTable
CREATE TABLE "AccessCard" (
    "id" TEXT NOT NULL,
    "cardType" "CardType" NOT NULL,
    "status" "CardStatus" NOT NULL DEFAULT 'active',
    "label" TEXT,
    "employeeId" TEXT,
    "issuedByEmployeeId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessGrant" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "locationId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "issuedByEmployeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccessCard_commandId_key" ON "AccessCard"("commandId");

-- CreateIndex
CREATE INDEX "AccessCard_status_cardType_idx" ON "AccessCard"("status", "cardType");

-- CreateIndex
CREATE INDEX "AccessCard_employeeId_status_idx" ON "AccessCard"("employeeId", "status");

-- CreateIndex
CREATE INDEX "AccessGrant_cardId_idx" ON "AccessGrant"("cardId");

-- CreateIndex
CREATE INDEX "AccessGrant_locationId_idx" ON "AccessGrant"("locationId");

-- CreateIndex
CREATE INDEX "AccessGrant_validFrom_validUntil_idx" ON "AccessGrant"("validFrom", "validUntil");

-- AddForeignKey
ALTER TABLE "AccessCard" ADD CONSTRAINT "AccessCard_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCard" ADD CONSTRAINT "AccessCard_issuedByEmployeeId_fkey" FOREIGN KEY ("issuedByEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "AccessCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_issuedByEmployeeId_fkey" FOREIGN KEY ("issuedByEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
