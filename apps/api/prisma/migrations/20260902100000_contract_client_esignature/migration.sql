-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "clientSignerName" TEXT,
ADD COLUMN     "clientSignedAt" TIMESTAMP(3),
ADD COLUMN     "clientSignatureIp" TEXT,
ADD COLUMN     "clientSignatureUserAgent" TEXT,
ADD COLUMN     "clientSignatureImageUrl" TEXT;

-- CreateTable
CREATE TABLE "ContractSigningLink" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractSigningLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContractSigningLink_tokenHash_key" ON "ContractSigningLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ContractSigningLink_contractId_idx" ON "ContractSigningLink"("contractId");

-- AddForeignKey
ALTER TABLE "ContractSigningLink" ADD CONSTRAINT "ContractSigningLink_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractSigningLink" ADD CONSTRAINT "ContractSigningLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
