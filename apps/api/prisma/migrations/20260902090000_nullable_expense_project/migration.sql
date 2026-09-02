-- AlterTable
-- projectId becomes optional: NULL means this cost is not tied to any site
-- (e.g. uniforms, office supplies, tools bought ahead of a future contract).
-- The existing ON DELETE CASCADE foreign key is left in place — it applies
-- only to rows that do have a projectId.
ALTER TABLE "Expense" ALTER COLUMN "projectId" DROP NOT NULL;
