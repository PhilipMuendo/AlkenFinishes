/**
 * Pure date math shared by pipeline.ts, calendarFeeds.ts, and the contract
 * PDF builder. Deliberately its own file with no other imports: contractPdf.ts
 * renders inside a worker thread (see workers/pdfWorker.ts), and pipeline.ts
 * imports `prisma` at module scope — importing dlpEnd from pipeline.ts would
 * have pulled a second PrismaClient into every render worker.
 */

/** Defects liability runs from practical completion, not from handover of site. */
export function dlpEnd(practicalCompletion: Date | null, months: number): string | null {
  if (!practicalCompletion) return null;
  const d = new Date(practicalCompletion);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
