-- CreateTable
CREATE TABLE "WeeklyReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "weekEnding" DATE NOT NULL,
    "summary" TEXT NOT NULL,
    "milestones" TEXT,
    "issues" TEXT,
    "nextWeekPlan" TEXT,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "submittedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyReport_projectId_weekEnding_idx" ON "WeeklyReport"("projectId", "weekEnding");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyReport_projectId_weekEnding_key" ON "WeeklyReport"("projectId", "weekEnding");

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

