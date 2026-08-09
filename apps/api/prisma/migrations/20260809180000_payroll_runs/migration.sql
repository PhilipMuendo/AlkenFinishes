-- Payroll runs and payslips.
--
-- Gross comes from attendance already recorded, so nobody retypes what the
-- fingerprint reader already knows.
--
-- Two things are deliberately STORED rather than recomputed on read:
--   * configSnapshot — the bands, tiers and levies in force when the run was
--     made. Rates change by finance act, and a payslip handed to a worker in
--     July must still show July's arithmetic when reopened in December.
--   * every figure on the payslip. Recomputing an old run against today's
--     rates would quietly rewrite what somebody was actually paid.

CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'FINALISED');

CREATE TABLE "PayrollRun" (
  "id"             TEXT NOT NULL,
  -- NULL is company-wide: statutory returns are filed for the company, not
  -- per site, so a run has to be able to span every project at once.
  "projectId"      TEXT,
  "periodFrom"     DATE NOT NULL,
  "periodTo"       DATE NOT NULL,
  "status"         "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
  "notes"          TEXT,
  "configSnapshot" JSONB NOT NULL,
  "createdById"    TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalisedAt"    TIMESTAMP(3),

  CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayrollRun_projectId_periodFrom_idx" ON "PayrollRun"("projectId", "periodFrom");
CREATE INDEX "PayrollRun_status_idx" ON "PayrollRun"("status");

ALTER TABLE "PayrollRun"
  ADD CONSTRAINT "PayrollRun_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayrollRun"
  ADD CONSTRAINT "PayrollRun_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PayrollLine" (
  "id"       TEXT NOT NULL,
  "runId"    TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  -- Denormalised so a payslip still reads correctly after a worker is renamed
  -- or their rate changes.
  "workerName" TEXT NOT NULL,
  "trade"      TEXT NOT NULL,

  "hoursWorked" DECIMAL(8,2)  NOT NULL,
  "gross"       DECIMAL(14,2) NOT NULL,

  "nssf"            DECIMAL(14,2) NOT NULL,
  "paye"            DECIMAL(14,2) NOT NULL,
  "shif"            DECIMAL(14,2) NOT NULL,
  "housingLevy"     DECIMAL(14,2) NOT NULL,
  "totalDeductions" DECIMAL(14,2) NOT NULL,
  "netPay"          DECIMAL(14,2) NOT NULL,

  -- A cost to the company on top of the wage, never taken from the worker.
  "employerNssf"        DECIMAL(14,2) NOT NULL,
  "employerHousingLevy" DECIMAL(14,2) NOT NULL,

  CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- One payslip per worker per run: a second row would double their pay.
CREATE UNIQUE INDEX "PayrollLine_runId_workerId_key" ON "PayrollLine"("runId", "workerId");
CREATE INDEX "PayrollLine_workerId_idx" ON "PayrollLine"("workerId");

ALTER TABLE "PayrollLine"
  ADD CONSTRAINT "PayrollLine_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not CASCADE: deleting a worker must not erase the record of what
-- they were paid and what was withheld from them on their behalf.
ALTER TABLE "PayrollLine"
  ADD CONSTRAINT "PayrollLine_workerId_fkey"
  FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
