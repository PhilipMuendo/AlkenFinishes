import { parentPort, workerData } from 'worker_threads';
import { renderContractPdf } from '../services/documents/contractPdf';
import { renderHandbookPdf } from '../services/documents/handbookPdf';
import { renderHandoverPdf } from '../services/documents/handoverPdf';
import { renderInvoicePdf } from '../services/documents/invoicePdf';
import { renderQuotationPdf } from '../services/documents/quotationPdf';
import { renderReceiptPdf } from '../services/documents/receiptPdf';
import { renderReportPdf } from '../services/documents/reportPdf';

/**
 * One-shot worker: spawned by pdfWorkerRunner.ts for a single PDF render,
 * then terminated. See that file for why this exists (pdfmake's layout pass
 * is synchronous CPU work that would otherwise block Express's event loop
 * for every other concurrent request) and for how arguments cross the
 * thread boundary (JSON, not structured clone — Decimal/Date fields need it).
 *
 * Every builder this dispatches to is imported statically above rather than
 * dynamically per task, so a build-breaking typo in any one of them fails
 * `tsc` at compile time instead of surfacing only when that specific
 * document type is next rendered.
 */
const BUILDERS = {
  contract: renderContractPdf,
  handbook: renderHandbookPdf,
  handover: renderHandoverPdf,
  invoice: renderInvoicePdf,
  quotation: renderQuotationPdf,
  receipt: renderReceiptPdf,
  report: renderReportPdf,
} as const;

export type PdfTaskName = keyof typeof BUILDERS;

async function run() {
  const { taskName, args } = workerData as { taskName: PdfTaskName; args: unknown[] };
  try {
    const build = BUILDERS[taskName];
    if (!build) throw new Error(`Unknown PDF worker task: ${taskName}`);
    // Every builder here takes plain-data arguments and returns Promise<string>
    // (an already-validated shape enforced by pdfWorkerRunner.ts's typed
    // wrappers) — the `any` is only needed because BUILDERS mixes seven
    // different parameter-list shapes into one lookup.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: string = await (build as (...a: any[]) => Promise<string>)(...args);
    parentPort!.postMessage({ ok: true, result });
  } catch (err) {
    parentPort!.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

void run();
