-- Paying a casual/contracted worker, and what is withheld from them.
--
-- Mirrors SupplierPayment: "amount" is cash the worker actually received.
-- "whtAmount" is tax deducted from the payment and owed to KRA instead — it
-- settles what attendance says is owed just as cash does, so a worker paid
-- 47,000 cash plus 3,000 withheld for KRA on a 50,000 balance is paid in
-- full, not left 3,000 short forever. No whtVatAmount here: unlike a VAT-
-- registered supplier, an individual worker being withheld from is not
-- charging VAT in the first place.
--
-- ON DELETE RESTRICT from Worker: matches PayrollLine — a worker with payment
-- history cannot be hard-deleted (workers.ts already blocks deletion once
-- attendance history exists, which a payment can only follow).

CREATE TABLE "WorkerPayment" (
  "id"            TEXT NOT NULL,
  "workerId"      TEXT NOT NULL,
  "amount"        DECIMAL(14,2) NOT NULL,
  "method"        "PaymentMethod" NOT NULL,
  "paymentDate"   TIMESTAMP(3) NOT NULL,
  "referenceNo"   TEXT,
  "notes"         TEXT,
  "proofUrl"      TEXT,
  "whtAmount"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  "whtCertNo"     TEXT,
  "whtRemittedAt" TIMESTAMP(3),
  "paidById"      TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkerPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkerPayment_workerId_idx" ON "WorkerPayment"("workerId");
CREATE INDEX "WorkerPayment_paymentDate_idx" ON "WorkerPayment"("paymentDate");

ALTER TABLE "WorkerPayment"
  ADD CONSTRAINT "WorkerPayment_workerId_fkey"
  FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkerPayment"
  ADD CONSTRAINT "WorkerPayment_paidById_fkey"
  FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
