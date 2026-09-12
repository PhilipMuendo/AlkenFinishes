-- CreateTable
CREATE TABLE "ProjectCloseout" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "lessonsLearned" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "pdfUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCloseout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCloseout_projectId_key" ON "ProjectCloseout"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectCloseout" ADD CONSTRAINT "ProjectCloseout_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCloseout" ADD CONSTRAINT "ProjectCloseout_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCloseout" ADD CONSTRAINT "ProjectCloseout_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
