-- CreateTable
CREATE TABLE "HandoverChecklist" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "notes" TEXT,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pdfUrl" TEXT,
    "clientSignerName" TEXT,
    "clientSignedAt" TIMESTAMP(3),
    "clientSignatureIp" TEXT,
    "clientSignatureUserAgent" TEXT,
    "clientSignatureImageUrl" TEXT,
    "companySignerName" TEXT,
    "companySignedAt" TIMESTAMP(3),
    "companySignatureImageUrl" TEXT,
    "companySignedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandoverChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverSigningLink" (
    "id" TEXT NOT NULL,
    "handoverId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoverSigningLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HandoverChecklist_projectId_key" ON "HandoverChecklist"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "HandoverSigningLink_tokenHash_key" ON "HandoverSigningLink"("tokenHash");

-- CreateIndex
CREATE INDEX "HandoverSigningLink_handoverId_idx" ON "HandoverSigningLink"("handoverId");

-- AddForeignKey
ALTER TABLE "HandoverChecklist" ADD CONSTRAINT "HandoverChecklist_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverChecklist" ADD CONSTRAINT "HandoverChecklist_companySignedById_fkey" FOREIGN KEY ("companySignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverChecklist" ADD CONSTRAINT "HandoverChecklist_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverSigningLink" ADD CONSTRAINT "HandoverSigningLink_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "HandoverChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverSigningLink" ADD CONSTRAINT "HandoverSigningLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
