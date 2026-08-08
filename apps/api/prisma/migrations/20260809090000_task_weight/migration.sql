-- Project progress was the plain mean of task completion, so every task counted
-- the same regardless of size and adding trivial tasks diluted the figure.
--
-- Weight defaults to 1: with all weights equal, a weighted mean IS the plain
-- mean, so every existing project reports exactly what it reported before and
-- nothing moves until somebody enters real weights.
ALTER TABLE "Task" ADD COLUMN "weight" DECIMAL(14,2) NOT NULL DEFAULT 1;
