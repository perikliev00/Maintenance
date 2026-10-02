-- CreateEnum
CREATE TYPE "Role" AS ENUM ('reception', 'housekeeper', 'supervisor');

-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "Occupancy" AS ENUM ('vacant', 'occupied', 'unknown');

-- CreateEnum
CREATE TYPE "CleaningStatus" AS ENUM ('dirty', 'in_progress', 'pending_inspection', 'verified_clean');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('in_service', 'out_of_service', 'unknown');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('assigned', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('running', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Floor" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Floor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "floorId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "catalogStatus" "CatalogStatus" NOT NULL DEFAULT 'active',
    "occupancy" "Occupancy" NOT NULL DEFAULT 'unknown',
    "cleaningStatus" "CleaningStatus" NOT NULL DEFAULT 'dirty',
    "serviceStatus" "ServiceStatus" NOT NULL DEFAULT 'in_service',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "department" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleaningTask" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "hotelDate" DATE NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'normal',
    "assignedEmployeeId" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'assigned',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CleaningTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleaningSession" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" "SessionStatus" NOT NULL DEFAULT 'running',
    "startCommandId" TEXT NOT NULL,
    "completeCommandId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CleaningSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Building_propertyId_code_key" ON "Building"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Floor_buildingId_number_key" ON "Floor"("buildingId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Location_floorId_number_key" ON "Location"("floorId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeNumber_key" ON "Employee"("employeeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "CleaningTask_hotelDate_status_idx" ON "CleaningTask"("hotelDate", "status");

-- CreateIndex
CREATE INDEX "CleaningTask_locationId_hotelDate_idx" ON "CleaningTask"("locationId", "hotelDate");

-- CreateIndex
CREATE UNIQUE INDEX "CleaningSession_startCommandId_key" ON "CleaningSession"("startCommandId");

-- CreateIndex
CREATE UNIQUE INDEX "CleaningSession_completeCommandId_key" ON "CleaningSession"("completeCommandId");

-- CreateIndex
CREATE INDEX "CleaningSession_taskId_status_idx" ON "CleaningSession"("taskId", "status");

-- CreateIndex
CREATE INDEX "CleaningSession_employeeId_status_idx" ON "CleaningSession"("employeeId", "status");

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Floor" ADD CONSTRAINT "Floor_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningTask" ADD CONSTRAINT "CleaningTask_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningTask" ADD CONSTRAINT "CleaningTask_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningSession" ADD CONSTRAINT "CleaningSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CleaningTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningSession" ADD CONSTRAINT "CleaningSession_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
