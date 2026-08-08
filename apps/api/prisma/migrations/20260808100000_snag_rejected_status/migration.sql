-- Rework loop for snags: a claimed fix the office refuses goes back to the
-- trade as REJECTED rather than being reset to OPEN, so a repeat offender is
-- distinguishable from an item nobody has attempted.
--
-- Kept in its own migration deliberately. Postgres will not let a newly added
-- enum value be USED in the same transaction that added it, so the columns and
-- tables that reference REJECTED live in the migration that follows this one.
ALTER TYPE "SnagStatus" ADD VALUE 'REJECTED';
