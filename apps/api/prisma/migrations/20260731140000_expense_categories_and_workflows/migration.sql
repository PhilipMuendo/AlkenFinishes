-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('MATERIALS', 'LABOUR', 'TRANSPORT', 'EQUIPMENT_HIRE', 'SUBCONTRACTOR', 'SITE_OVERHEADS', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MaterialRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FULFILLED');

-- CreateEnum
CREATE TYPE "OverrideRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SnagStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "SnagSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SafetyIncidentSeverity" AS ENUM ('NEAR_MISS', 'MINOR', 'SERIOUS');

-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('MILESTONE', 'INSPECTION', 'DELIVERY', 'MEETING', 'OTHER');

-- AlterTable
ALTER TABLE "DailyReport" ADD COLUMN     "delays" TEXT,
ADD COLUMN     "equipmentOnSite" TEXT,
ADD COLUMN     "instructionsGiven" TEXT,
ADD COLUMN     "materialsDelivered" TEXT,
ADD COLUMN     "safetyNotes" TEXT,
ADD COLUMN     "visitors" TEXT,
ADD COLUMN     "weather" TEXT;

-- AlterTable
-- expenseCategory added nullable, backfilled from the existing coarse
-- category (a 1:1 match for all four pre-existing values), then locked to
-- NOT NULL. Pre-existing expenses are marked APPROVED: they were already
-- counted as actual spend under the old always-counted behaviour, and this
-- migration must not silently zero out every project's spend-to-date.
ALTER TABLE "Expense" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "expenseCategory" "ExpenseCategory",
ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "status" "ExpenseStatus" NOT NULL DEFAULT 'PENDING';

UPDATE "Expense" SET "expenseCategory" = "category"::text::"ExpenseCategory";
UPDATE "Expense" SET "status" = 'APPROVED', "approvedAt" = "createdAt";

ALTER TABLE "Expense" ALTER COLUMN "expenseCategory" SET NOT NULL;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "geofenceLat" DECIMAL(9,6),
ADD COLUMN     "geofenceLng" DECIMAL(9,6),
ADD COLUMN     "geofenceRadiusM" INTEGER;

-- CreateTable
CREATE TABLE "MaterialRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "neededBy" DATE,
    "notes" TEXT,
    "status" "MaterialRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceOverrideRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "withinGeofence" BOOLEAN,
    "status" "OverrideRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "resultingRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceOverrideRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnagItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "severity" "SnagSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "SnagStatus" NOT NULL DEFAULT 'OPEN',
    "photoUrl" TEXT,
    "annotation" JSONB,
    "dueDate" DATE,
    "assignedToId" TEXT,
    "resolvedPhotoUrl" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "lastActionById" TEXT,
    "reportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnagItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyIncident" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "severity" "SafetyIncidentSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "actionTaken" TEXT,
    "photoUrl" TEXT,
    "reportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "type" "CalendarEventType" NOT NULL DEFAULT 'OTHER',
    "date" DATE NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialRequest_projectId_status_idx" ON "MaterialRequest"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceOverrideRequest_resultingRecordId_key" ON "AttendanceOverrideRequest"("resultingRecordId");

-- CreateIndex
CREATE INDEX "AttendanceOverrideRequest_projectId_status_idx" ON "AttendanceOverrideRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "SnagItem_projectId_status_idx" ON "SnagItem"("projectId", "status");

-- CreateIndex
CREATE INDEX "SafetyIncident_projectId_occurredAt_idx" ON "SafetyIncident"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_projectId_date_idx" ON "CalendarEvent"("projectId", "date");

-- CreateIndex
CREATE INDEX "CalendarEvent_date_idx" ON "CalendarEvent"("date");

-- CreateIndex
CREATE INDEX "Expense_projectId_status_idx" ON "Expense"("projectId", "status");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceOverrideRequest" ADD CONSTRAINT "AttendanceOverrideRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceOverrideRequest" ADD CONSTRAINT "AttendanceOverrideRequest_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceOverrideRequest" ADD CONSTRAINT "AttendanceOverrideRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceOverrideRequest" ADD CONSTRAINT "AttendanceOverrideRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceOverrideRequest" ADD CONSTRAINT "AttendanceOverrideRequest_resultingRecordId_fkey" FOREIGN KEY ("resultingRecordId") REFERENCES "AttendanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnagItem" ADD CONSTRAINT "SnagItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnagItem" ADD CONSTRAINT "SnagItem_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnagItem" ADD CONSTRAINT "SnagItem_lastActionById_fkey" FOREIGN KEY ("lastActionById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnagItem" ADD CONSTRAINT "SnagItem_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

