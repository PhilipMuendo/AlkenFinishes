-- CreateTable
CREATE TABLE "Tool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currentProjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolTransfer" (
    "id" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "fromProjectId" TEXT,
    "toProjectId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "transferDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proofPhotoUrl" TEXT NOT NULL,
    "notes" TEXT,
    "transferredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tool_currentProjectId_idx" ON "Tool"("currentProjectId");

-- CreateIndex
CREATE INDEX "ToolTransfer_toolId_transferDate_idx" ON "ToolTransfer"("toolId", "transferDate");

-- CreateIndex
CREATE INDEX "ToolTransfer_toProjectId_idx" ON "ToolTransfer"("toProjectId");

-- CreateIndex
CREATE INDEX "ToolTransfer_fromProjectId_idx" ON "ToolTransfer"("fromProjectId");

-- AddForeignKey
ALTER TABLE "Tool" ADD CONSTRAINT "Tool_currentProjectId_fkey" FOREIGN KEY ("currentProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolTransfer" ADD CONSTRAINT "ToolTransfer_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolTransfer" ADD CONSTRAINT "ToolTransfer_fromProjectId_fkey" FOREIGN KEY ("fromProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolTransfer" ADD CONSTRAINT "ToolTransfer_toProjectId_fkey" FOREIGN KEY ("toProjectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolTransfer" ADD CONSTRAINT "ToolTransfer_transferredById_fkey" FOREIGN KEY ("transferredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

