-- Filing a weekly report for a week that already has one revises it in place
-- (the row is unique per project+week). Until now the card could only show
-- createdAt, so a summary rewritten on Friday still read as filed on Monday.
--
-- Backfilled to createdAt: a report nobody has revised was last changed when
-- it was written, which is exactly what the column should say.
ALTER TABLE "WeeklyReport" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "WeeklyReport" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "WeeklyReport" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "WeeklyReport" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
