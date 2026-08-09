-- Tax the client deducts before paying us.
--
-- Government bodies, parastatals and appointed withholding VAT agents remit a
-- slice of what they owe us straight to KRA. That slice settles the invoice
-- exactly as cash does: a client withholding 15,000 of a 500,000 claim clears
-- it by sending 485,000.
--
-- Counting only the cash — which is what every receivables aggregate did
-- before this migration — leaves such an invoice permanently short, marks it
-- PARTIALLY_PAID for ever, and puts it on the overdue list to be chased for
-- money that was never owed to us.
--
-- All columns default to zero/NULL, so every payment recorded before today
-- reads as one where nothing was withheld, and no invoice status or A/R figure
-- moves by a shilling.
ALTER TABLE "Payment"
  ADD COLUMN "whtAmount"         DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "whtVatAmount"      DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "whtCertNo"         TEXT,
  ADD COLUMN "whtCertReceivedAt" TIMESTAMP(3);

-- Chasing outstanding withholding certificates: "money withheld, no
-- certificate yet" is the query that matters, and it reads this index.
CREATE INDEX "Payment_whtCertReceivedAt_idx" ON "Payment"("whtCertReceivedAt");
