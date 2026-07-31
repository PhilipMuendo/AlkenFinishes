-- CreateEnum
CREATE TYPE "DeviceVendor" AS ENUM ('ZKTECO', 'SUPREMA');

-- AlterTable
ALTER TABLE "AttendanceDevice" ADD COLUMN     "biostarBaseUrl" TEXT,
ADD COLUMN     "biostarDeviceId" TEXT,
ADD COLUMN     "biostarInsecureTls" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "biostarLastEventId" TEXT,
ADD COLUMN     "biostarLoginId" TEXT,
ADD COLUMN     "biostarPasswordEnc" TEXT,
ADD COLUMN     "vendor" "DeviceVendor" NOT NULL DEFAULT 'ZKTECO';

