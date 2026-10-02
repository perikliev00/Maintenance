-- CreateTable
CREATE TABLE "Sector" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameBg" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "primarySupervisorEmployeeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectorLocation" (
    "sectorId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "SectorLocation_pkey" PRIMARY KEY ("sectorId","locationId")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameBg" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sector_propertyId_isActive_idx" ON "Sector"("propertyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Sector_propertyId_code_key" ON "Sector"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SectorLocation_locationId_key" ON "SectorLocation"("locationId");

-- CreateIndex
CREATE INDEX "SectorLocation_sectorId_idx" ON "SectorLocation"("sectorId");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_code_key" ON "Shift"("code");

-- CreateIndex
CREATE INDEX "Shift_isActive_sortOrder_idx" ON "Shift"("isActive", "sortOrder");

-- AddForeignKey
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_primarySupervisorEmployeeId_fkey" FOREIGN KEY ("primarySupervisorEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectorLocation" ADD CONSTRAINT "SectorLocation_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectorLocation" ADD CONSTRAINT "SectorLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
