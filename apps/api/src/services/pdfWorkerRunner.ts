import path from 'path';
import { Worker } from 'worker_threads';
import { env } from '../config/env';
import type { PdfTaskName } from '../workers/pdfWorker';
import type { renderContractPdf } from './documents/contractPdf';
import type { renderHandbookPdf } from './documents/handbookPdf';
import type { renderHandoverPdf } from './documents/handoverPdf';
import type { renderInvoicePdf } from './documents/invoicePdf';
import type { renderQuotationPdf } from './documents/quotationPdf';
import type { renderReceiptPdf } from './documents/receiptPdf';
import type { renderReportPdf } from './documents/reportPdf';

/**
 * pdfmake's layout pass (services/pdf.ts's `renderPdfToUpload`) is
 * synchronous, CPU-bound work. Called directly from a route handler, as
 * every PDF-producing route did before this file existed, it runs on
 * Express's single event-loop thread — while one invoice or contract is
 * rendering, every other concurrent request (including a different user's
 * dashboard load) stalls for however long that render takes. This file
 * moves the render itself into a short-lived worker_threads.Worker instead,
 * so it competes with other renders, not with the rest of the API.
 *
 * A worker per call, not a persistent pool: this app renders a document
 * per user action (issuing an invoice, signing a contract), not per
 * request-per-second — a pool's complexity (queueing, backpressure, worker
 * lifecycle) buys nothing at that volume. Thread spawn cost (a few ms) is
 * negligible next to the render itself.
 *
 * Arguments cross the thread boundary as JSON via workerData, deliberately
 * NOT worker_threads' structured-clone default: a Prisma `Decimal` field's
 * arithmetic relies on `Number(v)`, which needs Decimal's `toJSON()` (a
 * numeric string) to have already run — structured clone doesn't call it,
 * and would hand the worker a stripped plain object with no Decimal methods
 * left on it at all. The same JSON pass turns `Date` fields into ISO
 * strings, which is why every PDF builder's date formatting goes through
 * `printDate()` (services/pdf.ts), hardened to accept either form.
 */
const WORKER_PATH = path.join(__dirname, '../workers/pdfWorker' + (__filename.endsWith('.ts') ? '.ts' : '.js'));

interface WorkerResult {
  ok: boolean;
  result?: string;
  error?: string;
}

function runPdfWorker(taskName: PdfTaskName, args: unknown[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // JSON.parse(JSON.stringify(...)) rather than passing args straight
    // through: this is what actually invokes Decimal's and Date's toJSON()
    // — see the file docblock above.
    const safeArgs = JSON.parse(JSON.stringify(args));
    let settled = false;
    const worker = new Worker(WORKER_PATH, { workerData: { taskName, args: safeArgs } });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(new Error(`PDF render (${taskName}) timed out after ${env.PDF_RENDER_TIMEOUT_MS}ms`));
    }, env.PDF_RENDER_TIMEOUT_MS);
    timer.unref();

    worker.once('message', (msg: WorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (msg.ok && msg.result != null) resolve(msg.result);
      else reject(new Error(msg.error ?? `PDF render (${taskName}) failed with no error message`));
    });
    worker.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    worker.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`PDF render (${taskName}) worker exited early with code ${code}`));
    });
  });
}

// One thin, fully-typed wrapper per document — same parameter list and
// return type as the builder it replaces at the call site, so every route
// handler changes only its import, nothing about how it calls the function.
export function renderContractPdfAsync(...args: Parameters<typeof renderContractPdf>) {
  return runPdfWorker('contract', args);
}
export function renderHandbookPdfAsync(...args: Parameters<typeof renderHandbookPdf>) {
  return runPdfWorker('handbook', args);
}
export function renderHandoverPdfAsync(...args: Parameters<typeof renderHandoverPdf>) {
  return runPdfWorker('handover', args);
}
export function renderInvoicePdfAsync(...args: Parameters<typeof renderInvoicePdf>) {
  return runPdfWorker('invoice', args);
}
export function renderQuotationPdfAsync(...args: Parameters<typeof renderQuotationPdf>) {
  return runPdfWorker('quotation', args);
}
export function renderReceiptPdfAsync(...args: Parameters<typeof renderReceiptPdf>) {
  return runPdfWorker('receipt', args);
}
export function renderReportPdfAsync(...args: Parameters<typeof renderReportPdf>) {
  return runPdfWorker('report', args);
}
