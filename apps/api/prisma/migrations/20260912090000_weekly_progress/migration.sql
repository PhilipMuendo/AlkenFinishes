-- AlterTable: physical quantity tracking for the Planned vs Actual report
ALTER TABLE "Task" ADD COLUMN     "plannedQuantity" DECIMAL(14,2),
ADD COLUMN     "actualQuantity" DECIMAL(14,2),
ADD COLUMN     "unit" TEXT;

-- AlterTable: planned man-days on the LABOUR budget line
ALTER TABLE "BudgetLine" ADD COLUMN     "plannedLabourDays" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "WeeklyProgressReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "weekEnding" DATE NOT NULL,
    "data" JSONB NOT NULL,
    "pdfUrl" TEXT,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyProgressReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyProgressReport_projectId_weekEnding_key" ON "WeeklyProgressReport"("projectId", "weekEnding");

-- CreateIndex
CREATE INDEX "WeeklyProgressReport_projectId_weekEnding_idx" ON "WeeklyProgressReport"("projectId", "weekEnding");

-- AddForeignKey
ALTER TABLE "WeeklyProgressReport" ADD CONSTRAINT "WeeklyProgressReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyProgressReport" ADD CONSTRAINT "WeeklyProgressReport_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
