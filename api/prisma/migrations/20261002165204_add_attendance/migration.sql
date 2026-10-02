-- CreateEnum
CREATE TYPE "AttendanceEventKind" AS ENUM ('clock_in', 'break_start', 'break_end', 'clock_out');

-- CreateEnum
CREATE TYPE "AttendanceIntervalStatus" AS ENUM ('open', 'closed', 'needs_review', 'adjusted');

-- CreateEnum
CREATE TYPE "AttendanceAdjustmentStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "AttendanceEvent" (
    "id" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'terminal_sim',
    "employeeId" TEXT NOT NULL,
    "kind" "AttendanceEventKind" NOT NULL,
    "deviceTime" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "normalizedTime" TIMESTAMP(3) NOT NULL,
    "clockSkewSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceInterval" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "hotelDate" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "workedMinutes" INTEGER,
    "status" "AttendanceIntervalStatus" NOT NULL DEFAULT 'open',
    "anomalyFlags" JSONB NOT NULL DEFAULT '[]',
    "startEventId" TEXT,
    "endEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceInterval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceAdjustment" (
    "id" TEXT NOT NULL,
    "intervalId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "status" "AttendanceAdjustmentStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "proposedStartedAt" TIMESTAMP(3),
    "proposedEndedAt" TIMESTAMP(3),
    "proposedBreakMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "AttendanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceEvent_employeeId_normalizedTime_idx" ON "AttendanceEvent"("employeeId", "normalizedTime");

-- CreateIndex
CREATE INDEX "AttendanceEvent_kind_normalizedTime_idx" ON "AttendanceEvent"("kind", "normalizedTime");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceEvent_source_externalEventId_key" ON "AttendanceEvent"("source", "externalEventId");

-- CreateIndex
CREATE INDEX "AttendanceInterval_employeeId_hotelDate_idx" ON "AttendanceInterval"("employeeId", "hotelDate");

-- CreateIndex
CREATE INDEX "AttendanceInterval_status_hotelDate_idx" ON "AttendanceInterval"("status", "hotelDate");

-- CreateIndex
CREATE INDEX "AttendanceInterval_hotelDate_idx" ON "AttendanceInterval"("hotelDate");

-- CreateIndex
CREATE INDEX "AttendanceAdjustment_intervalId_status_idx" ON "AttendanceAdjustment"("intervalId", "status");

-- CreateIndex
CREATE INDEX "AttendanceAdjustment_status_createdAt_idx" ON "AttendanceAdjustment"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceInterval" ADD CONSTRAINT "AttendanceInterval_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAdjustment" ADD CONSTRAINT "AttendanceAdjustment_intervalId_fkey" FOREIGN KEY ("intervalId") REFERENCES "AttendanceInterval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAdjustment" ADD CONSTRAINT "AttendanceAdjustment_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAdjustment" ADD CONSTRAINT "AttendanceAdjustment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
