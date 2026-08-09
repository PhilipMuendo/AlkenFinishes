-- Supplier payables: what we owe, and what we have paid so far against it.
--
-- The ledger hangs off Expense rather than introducing a second cost record,
-- so the budget keeps counting each cost exactly once. An expense only joins
-- the ledger when it carries a supplier; every row written before this
-- migration has supplierId NULL and is therefore reported as settled, not as
-- newly unpaid.

CREATE TABLE "Supplier" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "contactName" TEXT,
  "phone"       TEXT,
  "email"       TEXT,
  "kraPin"      TEXT,
  "notes"       TEXT,
  -- Retired, never deleted: the name is printed on costs already reported.
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");
CREATE INDEX "Supplier_active_name_idx" ON "Supplier"("active", "name");

-- "amount" keeps its meaning: the GROSS figure on the supplier's invoice, which
-- is what we owe them and what the ledger settles against. vatAmount is the
-- input VAT contained within it, so the ex-VAT cost is amount - vatAmount.
-- Both tax columns default to zero, so every existing row reads as a supplier
-- who charged no VAT — which is how an expense with no VAT recorded should
-- behave, and means no historic project cost moves by a shilling.
ALTER TABLE "Expense"
  ADD COLUMN "supplierId"        TEXT,
  ADD COLUMN "supplierInvoiceNo" TEXT,
  ADD COLUMN "dueDate"           TIMESTAMP(3),
  ADD COLUMN "vatRatePct"        DECIMAL(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN "vatAmount"         DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxInvoice"        BOOLEAN       NOT NULL DEFAULT false;

CREATE INDEX "Expense_supplierId_dueDate_idx" ON "Expense"("supplierId", "dueDate");

-- ON DELETE SET NULL: retiring a supplier must never delete the costs booked
-- against them, and must never silently change a project's reported spend.
ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- "amount" is the cash the supplier actually received. Tax withheld from the
-- payment and owed to KRA instead settles the bill just as cash does: withhold
-- 15,000 of a 500,000 bill and paying 485,000 clears it in full. Without these
-- columns the bill would sit short for ever and eventually be paid twice.
CREATE TABLE "SupplierPayment" (
  "id"            TEXT NOT NULL,
  "expenseId"     TEXT NOT NULL,
  "amount"        DECIMAL(14,2) NOT NULL,
  "method"        "PaymentMethod" NOT NULL,
  "paymentDate"   TIMESTAMP(3) NOT NULL,
  "referenceNo"   TEXT,
  "notes"         TEXT,
  "proofUrl"      TEXT,
  "whtAmount"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  "whtVatAmount"  DECIMAL(14,2) NOT NULL DEFAULT 0,
  "whtCertNo"     TEXT,
  "whtRemittedAt" TIMESTAMP(3),
  "paidById"      TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierPayment_expenseId_idx" ON "SupplierPayment"("expenseId");
CREATE INDEX "SupplierPayment_paymentDate_idx" ON "SupplierPayment"("paymentDate");

-- CASCADE from the expense: a payment against a cost that no longer exists is
-- not a payment, it is an orphan that would keep appearing in cash-out totals.
ALTER TABLE "SupplierPayment"
  ADD CONSTRAINT "SupplierPayment_expenseId_fkey"
  FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierPayment"
  ADD CONSTRAINT "SupplierPayment_paidById_fkey"
  FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
