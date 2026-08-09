-- Progress claims. An invoice line can now say which item of the priced
-- schedule it claims against, and how complete that item is TO DATE.
--
-- The value of a claim is derived: cumulative value minus whatever earlier
-- claims already took. "Previously claimed" is deliberately NOT a column — it
-- is a sum over prior invoices, and a stored copy could disagree with them.
--
-- ON DELETE SET NULL, not CASCADE: deleting a quotation must never silently
-- rewrite the totals of an already-issued legal document.
ALTER TABLE "InvoiceLine"
  ADD COLUMN "sourceLineId"  TEXT,
  ADD COLUMN "cumulativePct" DECIMAL(5,2);

CREATE INDEX "InvoiceLine_sourceLineId_idx" ON "InvoiceLine"("sourceLineId");

ALTER TABLE "InvoiceLine"
  ADD CONSTRAINT "InvoiceLine_sourceLineId_fkey"
  FOREIGN KEY ("sourceLineId") REFERENCES "QuotationLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
