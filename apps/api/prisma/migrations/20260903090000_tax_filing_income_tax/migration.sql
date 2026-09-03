-- CreateTable
CREATE TABLE "VatFiling" (
    "id" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "netVatPayable" DECIMAL(14,2) NOT NULL,
    "filedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "itaxAckNo" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VatFiling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeTaxInstalment" (
    "id" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "instalmentNo" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "estimatedTaxForYear" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "itaxAckNo" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeTaxInstalment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeTaxReturn" (
    "id" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "taxableProfitEstimate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxDue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "filedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "itaxAckNo" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeTaxReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VatFiling_periodFrom_periodTo_key" ON "VatFiling"("periodFrom", "periodTo");

-- CreateIndex
CREATE UNIQUE INDEX "IncomeTaxInstalment_taxYear_instalmentNo_key" ON "IncomeTaxInstalment"("taxYear", "instalmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "IncomeTaxReturn_taxYear_key" ON "IncomeTaxReturn"("taxYear");

-- AddForeignKey
ALTER TABLE "VatFiling" ADD CONSTRAINT "VatFiling_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeTaxInstalment" ADD CONSTRAINT "IncomeTaxInstalment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeTaxReturn" ADD CONSTRAINT "IncomeTaxReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
