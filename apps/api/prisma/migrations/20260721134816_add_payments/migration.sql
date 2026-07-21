-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('DEPOSIT', 'INSTALLMENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'MPESA', 'CHEQUE', 'OTHER');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "balanceDueDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "PaymentType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "receiptUrl" TEXT,
    "submittedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_projectId_paymentDate_idx" ON "Payment"("projectId", "paymentDate");

-- CreateIndex
CREATE INDEX "Payment_projectId_type_idx" ON "Payment"("projectId", "type");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

