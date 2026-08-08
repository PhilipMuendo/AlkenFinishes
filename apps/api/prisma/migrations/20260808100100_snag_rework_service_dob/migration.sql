-- How many times a claimed fix has been sent back, plus the last rejection.
-- reworkCount is denormalised from SnagAttempt on purpose: it is the figure the
-- office argues about, and reading it should not require walking the history.
ALTER TABLE "SnagItem"
  ADD COLUMN "reworkCount"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rejectedAt"   TIMESTAMP(3),
  ADD COLUMN "rejectReason" TEXT;

-- Append-only history of fix attempts. Kept separate from SnagItem so the
-- evidence photo of a failed attempt survives the next attempt overwriting
-- SnagItem.resolvedPhotoUrl.
CREATE TABLE "SnagAttempt" (
  "id"            TEXT NOT NULL,
  "snagId"        TEXT NOT NULL,
  "attempt"       INTEGER NOT NULL,
  "photoUrl"      TEXT,
  "notes"         TEXT,
  "accepted"      BOOLEAN,
  "rejectReason"  TEXT,
  "reviewedAt"    TIMESTAMP(3),
  "reviewedById"  TEXT,
  "submittedById" TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SnagAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SnagAttempt_snagId_attempt_key" ON "SnagAttempt"("snagId", "attempt");
CREATE INDEX "SnagAttempt_snagId_idx" ON "SnagAttempt"("snagId");

ALTER TABLE "SnagAttempt"
  ADD CONSTRAINT "SnagAttempt_snagId_fkey"
  FOREIGN KEY ("snagId") REFERENCES "SnagItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnagAttempt"
  ADD CONSTRAINT "SnagAttempt_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SnagAttempt"
  ADD CONSTRAINT "SnagAttempt_submittedById_fkey"
  FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Equipment servicing and worker birthdays. Both feed the calendar, and both
-- are plain dates rather than derived state: a service date in the past is
-- what makes a tool overdue, so nobody has to remember to clear a flag.
ALTER TABLE "Tool"   ADD COLUMN "nextServiceDate" DATE;
ALTER TABLE "Worker" ADD COLUMN "dateOfBirth"     DATE;
