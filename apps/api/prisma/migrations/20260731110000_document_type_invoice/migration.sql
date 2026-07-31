-- AlterEnum
-- Shipped as its own migration: PostgreSQL will not let a newly added enum
-- value be referenced inside the same transaction that adds it, so keeping
-- this alone guarantees later migrations can use 'INVOICE' freely.
ALTER TYPE "DocumentType" ADD VALUE 'INVOICE';
