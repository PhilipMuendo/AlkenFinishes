-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ACCOUNTANT';

-- DropIndex
DROP INDEX "Payment_whtCertReceivedAt_idx";
