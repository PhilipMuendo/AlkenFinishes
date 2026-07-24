-- AlterTable
ALTER TABLE "AttendanceDevice" ADD COLUMN     "serialNumber" TEXT;

-- CreateTable
CREATE TABLE "AttendanceSyncIssue" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT,
    "biometricId" TEXT NOT NULL,
    "workerId" TEXT,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AttendanceSyncIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceSyncIssue_resolvedAt_lastSeenAt_idx" ON "AttendanceSyncIssue"("resolvedAt", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSyncIssue_deviceId_biometricId_reason_key" ON "AttendanceSyncIssue"("deviceId", "biometricId", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDevice_serialNumber_key" ON "AttendanceDevice"("serialNumber");

-- AddForeignKey
ALTER TABLE "AttendanceSyncIssue" ADD CONSTRAINT "AttendanceSyncIssue_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

