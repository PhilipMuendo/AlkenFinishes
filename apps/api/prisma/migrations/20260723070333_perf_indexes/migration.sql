-- DropIndex
DROP INDEX "DailyReport_projectId_date_idx";

-- CreateIndex
CREATE INDEX "Document_projectId_createdAt_idx" ON "Document"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskPhoto_taskId_idx" ON "TaskPhoto"("taskId");
