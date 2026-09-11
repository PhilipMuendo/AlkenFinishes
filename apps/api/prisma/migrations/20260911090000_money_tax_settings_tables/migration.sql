-- CreateTable
CREATE TABLE "FinanceSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "yellowPct" INTEGER NOT NULL DEFAULT 80,
    "redPct" INTEGER NOT NULL DEFAULT 100,
    "labourCostSource" TEXT NOT NULL DEFAULT 'BOTH',

    CONSTRAINT "FinanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseTaxSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "vatRatePct" DECIMAL(5,2) NOT NULL DEFAULT 16,
    "billsIncludeVat" BOOLEAN NOT NULL DEFAULT true,
    "defaultWhtRatePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "defaultWhtVatRatePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "withholdingAgent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PurchaseTaxSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTaxSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "withholdingAgent" BOOLEAN NOT NULL DEFAULT false,
    "defaultWhtRatePct" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "StaffTaxSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeTaxSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "ratePct" DECIMAL(5,2) NOT NULL DEFAULT 30,

    CONSTRAINT "IncomeTaxSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "personalReliefPerMonth" DECIMAL(10,2) NOT NULL DEFAULT 2400,
    "shifRatePct" DECIMAL(5,2) NOT NULL DEFAULT 2.75,
    "shifMinimum" DECIMAL(10,2) NOT NULL DEFAULT 300,
    "housingLevyEmployeePct" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
    "housingLevyEmployerPct" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
    "payeBands" JSONB NOT NULL DEFAULT '[{"upTo":24000,"ratePct":10},{"upTo":32333,"ratePct":25},{"upTo":500000,"ratePct":30},{"upTo":800000,"ratePct":32.5},{"upTo":null,"ratePct":35}]',
    "nssfTiers" JSONB NOT NULL DEFAULT '[{"upTo":8000,"employeePct":6,"employerPct":6},{"upTo":72000,"employeePct":6,"employerPct":6}]',

    CONSTRAINT "PayrollSettings_pkey" PRIMARY KEY ("id")
);

-- Carry forward whatever was already configured under the old generic
-- Setting rows, one INSERT per table, defaulting any missing field to the
-- same value the app's own DEFAULT_* constant already used. A row is only
-- inserted here if the old Setting key existed at all; if not, the table's
-- own column DEFAULTs above are exactly what getFinanceSettings() etc. would
-- have returned for a missing key, so an application-level getPayrollConfig()
-- style fallback still applies via a plain unconditional-insert-if-absent
-- below.
INSERT INTO "FinanceSettings" ("id", "yellowPct", "redPct", "labourCostSource")
SELECT 1,
  COALESCE((SELECT (value->>'yellowPct')::int FROM "Setting" WHERE key = 'budgetThresholds'), 80),
  COALESCE((SELECT (value->>'redPct')::int FROM "Setting" WHERE key = 'budgetThresholds'), 100),
  COALESCE((SELECT trim(both '"' from (value)::text) FROM "Setting" WHERE key = 'labourCostSource'), 'BOTH')
ON CONFLICT (id) DO NOTHING;

INSERT INTO "PurchaseTaxSettings" ("id", "vatRatePct", "billsIncludeVat", "defaultWhtRatePct", "defaultWhtVatRatePct", "withholdingAgent")
SELECT 1,
  COALESCE((SELECT (value->>'vatRatePct')::decimal FROM "Setting" WHERE key = 'purchaseTax'), 16),
  COALESCE((SELECT (value->>'billsIncludeVat')::boolean FROM "Setting" WHERE key = 'purchaseTax'), true),
  COALESCE((SELECT (value->>'defaultWhtRatePct')::decimal FROM "Setting" WHERE key = 'purchaseTax'), 0),
  COALESCE((SELECT (value->>'defaultWhtVatRatePct')::decimal FROM "Setting" WHERE key = 'purchaseTax'), 0),
  COALESCE((SELECT (value->>'withholdingAgent')::boolean FROM "Setting" WHERE key = 'purchaseTax'), false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO "StaffTaxSettings" ("id", "withholdingAgent", "defaultWhtRatePct")
SELECT 1,
  COALESCE((SELECT (value->>'withholdingAgent')::boolean FROM "Setting" WHERE key = 'staffTax'), false),
  COALESCE((SELECT (value->>'defaultWhtRatePct')::decimal FROM "Setting" WHERE key = 'staffTax'), 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO "IncomeTaxSettings" ("id", "enabled", "ratePct")
SELECT 1,
  COALESCE((SELECT (value->>'enabled')::boolean FROM "Setting" WHERE key = 'incomeTax'), false),
  COALESCE((SELECT (value->>'ratePct')::decimal FROM "Setting" WHERE key = 'incomeTax'), 30)
ON CONFLICT (id) DO NOTHING;

INSERT INTO "PayrollSettings" ("id", "enabled", "personalReliefPerMonth", "shifRatePct", "shifMinimum", "housingLevyEmployeePct", "housingLevyEmployerPct", "payeBands", "nssfTiers")
SELECT 1,
  COALESCE((SELECT (value->>'enabled')::boolean FROM "Setting" WHERE key = 'payroll'), false),
  COALESCE((SELECT (value->>'personalReliefPerMonth')::decimal FROM "Setting" WHERE key = 'payroll'), 2400),
  COALESCE((SELECT (value->>'shifRatePct')::decimal FROM "Setting" WHERE key = 'payroll'), 2.75),
  COALESCE((SELECT (value->>'shifMinimum')::decimal FROM "Setting" WHERE key = 'payroll'), 300),
  COALESCE((SELECT (value->>'housingLevyEmployeePct')::decimal FROM "Setting" WHERE key = 'payroll'), 1.5),
  COALESCE((SELECT (value->>'housingLevyEmployerPct')::decimal FROM "Setting" WHERE key = 'payroll'), 1.5),
  COALESCE((SELECT value->'payeBands' FROM "Setting" WHERE key = 'payroll'), '[{"upTo":24000,"ratePct":10},{"upTo":32333,"ratePct":25},{"upTo":500000,"ratePct":30},{"upTo":800000,"ratePct":32.5},{"upTo":null,"ratePct":35}]'::jsonb),
  COALESCE((SELECT value->'nssfTiers' FROM "Setting" WHERE key = 'payroll'), '[{"upTo":8000,"employeePct":6,"employerPct":6},{"upTo":72000,"employeePct":6,"employerPct":6}]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- The old blobs are now fully superseded — remove them rather than leave
-- stale duplicate data that nothing reads any more.
DELETE FROM "Setting" WHERE key IN ('purchaseTax', 'staffTax', 'incomeTax', 'payroll', 'budgetThresholds', 'labourCostSource');
