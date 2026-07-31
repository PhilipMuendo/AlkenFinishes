-- The Contract Sum is stored exclusive of VAT (see schema comment), so the
-- contract needs to carry its own rate to present the gross figure and to keep
-- retention calculated on the ex-VAT base, as on invoices.
ALTER TABLE "Contract" ADD COLUMN     "vatRatePct" DECIMAL(5,2) NOT NULL DEFAULT 16;
