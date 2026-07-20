-- DropIndex
DROP INDEX "AttendanceRecord_externalId_key";

-- AlterTable
ALTER TABLE "AttendanceDevice" ADD COLUMN     "projectId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_deviceId_externalId_key" ON "AttendanceRecord"("deviceId", "externalId");

