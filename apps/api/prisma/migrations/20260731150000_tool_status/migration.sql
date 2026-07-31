-- CreateEnum
CREATE TYPE "ToolStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'RETIRED');

-- AlterTable
ALTER TABLE "Tool" ADD COLUMN     "conditionNotes" TEXT,
ADD COLUMN     "status" "ToolStatus" NOT NULL DEFAULT 'ACTIVE';

