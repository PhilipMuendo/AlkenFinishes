-- AlterTable: the office's own signature on a contract, captured live at
-- countersign time (see Contract.clientSign* columns from the prior migration).
ALTER TABLE "Contract" ADD COLUMN     "companySignerName" TEXT,
ADD COLUMN     "companySignedAt" TIMESTAMP(3),
ADD COLUMN     "companySignatureImageUrl" TEXT,
ADD COLUMN     "companySignedById" TEXT;

-- CreateTable
CREATE TABLE "QuotationDecisionLink" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotationDecisionLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierStatementLink" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierStatementLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuotationDecisionLink_tokenHash_key" ON "QuotationDecisionLink"("tokenHash");

-- CreateIndex
CREATE INDEX "QuotationDecisionLink_quotationId_idx" ON "QuotationDecisionLink"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierStatementLink_tokenHash_key" ON "SupplierStatementLink"("tokenHash");

-- CreateIndex
CREATE INDEX "SupplierStatementLink_supplierId_idx" ON "SupplierStatementLink"("supplierId");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_companySignedById_fkey" FOREIGN KEY ("companySignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationDecisionLink" ADD CONSTRAINT "QuotationDecisionLink_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationDecisionLink" ADD CONSTRAINT "QuotationDecisionLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierStatementLink" ADD CONSTRAINT "SupplierStatementLink_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierStatementLink" ADD CONSTRAINT "SupplierStatementLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
