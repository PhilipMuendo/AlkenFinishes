import { PrismaClient } from '@prisma/client';

// Prisma's own defaults (maxWait: 2s, timeout: 5s) are unconfigured out of
// the box, which meant no explicit ceiling was actually in force here.
// Set them explicitly so an interactive `$transaction` that stalls — a lock
// wait, a slow query inside it — is killed rather than left to hold its
// connection (and the request awaiting it) indefinitely. 15s comfortably
// covers this app's real transactions (a handful of small writes each);
// anything past that means something is actually stuck.
export const prisma = new PrismaClient({
  transactionOptions: { maxWait: 5_000, timeout: 15_000 },
});
