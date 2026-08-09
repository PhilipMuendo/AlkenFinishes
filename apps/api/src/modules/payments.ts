import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, removeUploadedFile, signFileUrl, upload, verifyUpload } from '../middleware/upload';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { dueDateHealth } from '../services/payments';
import { nextNumber, seriesYear } from '../services/numbering';
import {
  aggregateSettledCents,
  getCompanyProfile,
  getInvoicingConfig,
  invoiceBalanceCents,
  PAYMENT_SETTLED_SUM,
  paymentSettledCents,
  projectReceivables,
  syncInvoiceStatus,
} from '../services/invoicing';
import { toCents } from '../services/money';
import { renderReceiptPdf, type PaymentForReceipt } from '../services/documents/receiptPdf';

/**
 * Payments are superadmin-only: contract sum, deposit, and payment history
 * are financial data the site supervisor must never see. requireSuperadmin
 * is stacked at the router level (not per-route, unlike expenses.ts) so no
 * route under this resource is ever reachable by a SUPERVISOR.
 */
const router = Router({ mergeParams: true });
router.use(requireAuth, requireSuperadmin, requireProjectAccess);

const include = {
  submittedBy: { select: { id: true, name: true } },
  invoice: { select: { id: true, invoiceNo: true, type: true } },
} as const;

/** Signs both receipt documents. They are different artifacts — see the schema. */
function serialize<
  T extends {
    receiptUrl: string | null;
    receiptPdfUrl: string | null;
    amount: unknown;
    whtAmount?: unknown;
    whtVatAmount?: unknown;
  },
>(p: T) {
  const whtAmount = Number(p.whtAmount ?? 0);
  const whtVatAmount = Number(p.whtVatAmount ?? 0);
  return {
    ...p,
    amount: Number(p.amount),
    whtAmount,
    whtVatAmount,
    // What this receipt actually took off the invoice. Derived here so no
    // caller has to remember to add the withheld tax back on.
    settled: Number(p.amount) + whtAmount + whtVatAmount,
    receiptUrl: signFileUrl(p.receiptUrl),
    receiptPdfUrl: signFileUrl(p.receiptPdfUrl),
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const payments = await prisma.payment.findMany({
      where: { projectId: req.params.projectId },
      include,
      orderBy: { paymentDate: 'desc' },
      take: 500,
    });
    res.json(payments.map(serialize));
  }),
);

// Registered before any /:id route.
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const projectId = req.params.projectId;
    const [project, payments, receivables] = await Promise.all([
      prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { contractValue: true, balanceDueDate: true },
      }),
      prisma.payment.findMany({ where: { projectId }, include, orderBy: { paymentDate: 'asc' } }),
      projectReceivables(projectId),
    ]);
    // Voided receipts are not money received, so they are excluded from every
    // total here while still being listed (struck through) for the audit trail.
    const live = payments.filter((p) => p.voidedAt === null);
    const deposit = live.find((p) => p.type === 'DEPOSIT') ?? null;
    const installments = payments.filter((p) => p.type === 'INSTALLMENT');
    const totalPaid = live.reduce((s, p) => s + Number(p.amount), 0);
    const contractValue = Number(project.contractValue);
    const pendingBalance = contractValue - totalPaid;

    res.json({
      contractValue,
      totalPaid,
      // "Balance on contract" — deliberately NOT redefined as receivables.
      // It answers "what is still owed on this job overall", while
      // arOutstanding answers "what have we billed that is still unpaid".
      // The two rarely match and the UI labels them separately.
      pendingBalance,
      balanceDueDate: project.balanceDueDate,
      dueDateHealth: dueDateHealth(pendingBalance, project.balanceDueDate),
      invoicedNet: receivables.invoicedNet,
      arOutstanding: receivables.arOutstanding,
      arOverdue: receivables.arOverdue,
      retentionHeld: receivables.retentionHeld,
      onAccount: receivables.onAccount,
      deposit: deposit ? serialize(deposit) : null,
      installments: installments.map(serialize),
    });
  }),
);

/**
 * multipart/form-data carries every field as a string, and z.coerce.boolean()
 * reads the string "false" as TRUE — every non-empty string is truthy. Without
 * this, a form that posts allowOverpay="false" would wave an overpayment
 * straight through the guard below.
 */
const formBool = z.preprocess(
  (v) => (typeof v === 'string' ? ['true', 'on', '1', 'yes'].includes(v.toLowerCase()) : v),
  z.boolean(),
);
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const paymentSchema = z
  .object({
    type: z.enum(['DEPOSIT', 'INSTALLMENT']),
    // Nonnegative rather than positive: a client can settle entirely by
    // withholding certificate, where no cash lands at all. The refine below
    // still rejects a payment that settles nothing.
    amount: z.coerce.number().nonnegative(),
    method: z.enum(['CASH', 'BANK_TRANSFER', 'MPESA', 'CHEQUE', 'OTHER']),
    paymentDate: z.coerce.date(),
    notes: z.string().optional(),
    invoiceId: z.preprocess(blank, z.string().optional()),
    bankName: z.string().optional(),
    referenceNo: z.string().optional(),
    // Tax the client deducted and remitted to KRA on our behalf.
    whtAmount: z.preprocess(blank, z.coerce.number().nonnegative().optional()),
    whtVatAmount: z.preprocess(blank, z.coerce.number().nonnegative().optional()),
    whtCertNo: z.preprocess(blank, z.string().optional()),
    allowOverpay: z.preprocess((v) => blank(v) ?? false, formBool),
  })
  .refine((d) => d.amount + (d.whtAmount ?? 0) + (d.whtVatAmount ?? 0) > 0, {
    path: ['amount'],
    message: 'A receipt must record either money received or tax withheld',
  })
  .refine(
    (d) =>
      // Cash that landed needs a reference; a nil-cash withholding entry has
      // no bank transaction to reference in the first place.
      d.amount === 0 || !['BANK_TRANSFER', 'MPESA', 'CHEQUE'].includes(d.method) || !!d.referenceNo,
    {
      path: ['referenceNo'],
      message: 'A transaction reference is required for bank, M-Pesa and cheque payments',
    },
  );

// multipart/form-data with an optional `receipt` file — the CLIENT's proof of
// payment. Our own numbered receipt is generated below, after commit.
router.post(
  '/',
  upload.single('receipt'),
  asyncHandler(async (req, res) => {
    const data = paymentSchema.parse(req.body);
    await verifyUpload(req.file);
    const projectId = req.params.projectId;
    const config = await getInvoicingConfig();

    const payment = await prisma.$transaction(async (tx) => {
      if (data.type === 'DEPOSIT') {
        const existing = await tx.payment.findFirst({
          where: { projectId, type: 'DEPOSIT', voidedAt: null },
        });
        if (existing) {
          throw ApiError.conflict('A deposit has already been recorded for this project');
        }
      }

      if (data.invoiceId) {
        const inv = await tx.invoice.findUnique({
          where: { id: data.invoiceId },
          include: { payments: { where: { voidedAt: null }, select: PAYMENT_SETTLED_SUM } },
        });
        if (!inv || inv.projectId !== projectId) throw ApiError.notFound('Invoice not found');
        if (inv.status === 'DRAFT') throw ApiError.conflict('That invoice has not been issued yet');
        if (inv.status === 'VOID') throw ApiError.conflict('That invoice has been voided');
        const paid = inv.payments.reduce((s, p) => s + paymentSettledCents(p), 0);
        const balance = invoiceBalanceCents(toCents(inv.netPayable), paid);
        // Compare what this receipt SETTLES, not just the cash: a client
        // sending 485,000 and withholding 15,000 clears a 500,000 balance
        // exactly, and must not be rejected as an overpayment of nothing.
        const settling = paymentSettledCents(data);
        if (!data.allowOverpay && settling > balance) {
          throw ApiError.conflict(
            `That is more than the ${(balance / 100).toLocaleString('en-KE', {
              minimumFractionDigits: 2,
            })} still outstanding on invoice ${inv.invoiceNo}`,
          );
        }
      }

      // First statement that touches the counter: consistent lock ordering.
      const receiptNo = await nextNumber(tx, 'RECEIPT', {
        prefix: config.receiptPrefix,
        year: seriesYear(data.paymentDate),
        pad: config.numberPadding,
      });

      const created = await tx.payment.create({
        data: {
          projectId,
          type: data.type,
          amount: data.amount,
          method: data.method,
          paymentDate: data.paymentDate,
          notes: data.notes,
          invoiceId: data.invoiceId,
          bankName: data.bankName,
          referenceNo: data.referenceNo,
          whtAmount: data.whtAmount ?? 0,
          whtVatAmount: data.whtVatAmount ?? 0,
          whtCertNo: data.whtCertNo,
          receiptNo,
          submittedById: req.user!.id,
          receiptUrl: req.file ? fileUrl(req.file.filename) : undefined,
        },
        include,
      });

      if (data.invoiceId) await syncInvoiceStatus(tx, data.invoiceId);

      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'payment.create',
          entity: 'Payment',
          entityId: created.id,
          meta: {
            amount: data.amount,
            type: data.type,
            method: data.method,
            receiptNo,
            invoiceId: data.invoiceId ?? null,
          },
          ip: req.ip,
        },
      });
      return created;
    });

    const withReceipt = await generateAndAttachReceipt(payment.id, req.user!.id);
    res.status(201).json(serialize(withReceipt));
  }),
);

const dueDateSchema = z.object({ balanceDueDate: z.coerce.date().nullable() });

router.put(
  '/due-date',
  asyncHandler(async (req, res) => {
    const { balanceDueDate } = dueDateSchema.parse(req.body);
    const project = await prisma.project.update({
      where: { id: req.params.projectId },
      data: { balanceDueDate },
      select: { id: true, balanceDueDate: true },
    });
    audit(req, 'project.balanceDueDate.set', 'Project', project.id, { balanceDueDate });
    res.json(project);
  }),
);

/** Signed link to our official receipt, regenerating it if it is missing. */
router.get(
  '/:id/receipt',
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!payment || payment.projectId !== req.params.projectId) throw ApiError.notFound();
    if (!payment.receiptNo) {
      throw ApiError.conflict('This payment predates receipt numbering — issue a receipt first');
    }
    const ready =
      payment.receiptPdfUrl && fileExists(payment.receiptPdfUrl)
        ? payment
        : await generateAndAttachReceipt(payment.id, req.user!.id);
    res.json({ url: signFileUrl(ready.receiptPdfUrl) });
  }),
);

/**
 * Issues a receipt for a payment recorded before receipt numbering existed.
 * It takes today's next number rather than back-filling into the historical
 * sequence — emitting numbered documents out of date order would make the
 * series look fabricated.
 */
router.post(
  '/:id/receipt',
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!payment || payment.projectId !== req.params.projectId) throw ApiError.notFound();
    if (payment.voidedAt) throw ApiError.conflict('This payment has been voided');
    if (payment.receiptNo) {
      const ready =
        payment.receiptPdfUrl && fileExists(payment.receiptPdfUrl)
          ? payment
          : await generateAndAttachReceipt(payment.id, req.user!.id);
      return res.json({ url: signFileUrl(ready.receiptPdfUrl) });
    }

    const config = await getInvoicingConfig();
    await prisma.$transaction(async (tx) => {
      const receiptNo = await nextNumber(tx, 'RECEIPT', {
        prefix: config.receiptPrefix,
        year: seriesYear(new Date()),
        pad: config.numberPadding,
      });
      await tx.payment.update({ where: { id: payment.id }, data: { receiptNo } });
    });
    const withReceipt = await generateAndAttachReceipt(payment.id, req.user!.id);
    audit(req, 'payment.receipt.issue', 'Payment', payment.id, {
      receiptNo: withReceipt.receiptNo,
    });
    res.json({ url: signFileUrl(withReceipt.receiptPdfUrl) });
  }),
);

/**
 * Void, not delete. Once an official receipt number is issued, deleting the
 * row would leave a hole in the receipt series and destroy the audit trail.
 * The row and its number stay; every money aggregate filters voidedAt: null.
 */
router.post(
  '/:id/void',
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().min(3, 'Give a reason') }).parse(req.body);
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!payment || payment.projectId !== req.params.projectId) throw ApiError.notFound();
    if (payment.voidedAt) throw ApiError.conflict('This payment is already void');

    const voided = await prisma.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: { voidedAt: new Date(), voidedById: req.user!.id, voidReason: reason },
        include,
      });
      if (payment.invoiceId) await syncInvoiceStatus(tx, payment.invoiceId);
      return updated;
    });

    audit(req, 'payment.void', 'Payment', payment.id, {
      amount: Number(payment.amount),
      receiptNo: payment.receiptNo,
      reason,
    });
    res.json(serialize(voided));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!payment || payment.projectId !== req.params.projectId) throw ApiError.notFound();
    if (payment.receiptNo) {
      throw ApiError.conflict(
        'This payment has an official receipt. Void it instead so the receipt series stays intact.',
      );
    }
    await prisma.$transaction(async (tx) => {
      await tx.payment.delete({ where: { id: payment.id } });
      if (payment.invoiceId) await syncInvoiceStatus(tx, payment.invoiceId);
    });
    removeUploadedFile(payment.receiptUrl);
    audit(req, 'payment.delete', 'Payment', payment.id, {
      amount: Number(payment.amount),
      type: payment.type,
    });
    res.json({ ok: true });
  }),
);

function uploadPath(uploadUrl: string): string {
  return path.join(path.resolve(env.UPLOAD_DIR), path.basename(uploadUrl.split('?')[0]));
}

function fileExists(uploadUrl: string): boolean {
  return fs.existsSync(uploadPath(uploadUrl));
}

/**
 * Renders our official receipt and files it in the project's Documents tab.
 *
 * Runs OUTSIDE the payment transaction: rendering is slow, and holding the
 * NumberSequence lock across it would serialise concurrent payments. If it
 * fails, the payment still exists with its number and GET /:id/receipt
 * regenerates on demand — the payment is never lost to a PDF error.
 */
async function generateAndAttachReceipt(paymentId: string, userId: string) {
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: {
      invoice: { select: { id: true, invoiceNo: true, netPayable: true } },
      project: { select: { name: true, clientName: true } },
    },
  });

  let balanceAfter: number | null = null;
  if (payment.invoice) {
    const agg = await prisma.payment.aggregate({
      where: { invoiceId: payment.invoice.id, voidedAt: null },
      _sum: PAYMENT_SETTLED_SUM,
    });
    // The balance printed on the receipt must count tax the client withheld,
    // or the client is handed a document saying they still owe money they
    // have already remitted to KRA on our behalf.
    balanceAfter =
      invoiceBalanceCents(toCents(payment.invoice.netPayable), aggregateSettledCents(agg._sum)) /
      100;
  }

  try {
    const [company, config] = await Promise.all([getCompanyProfile(), getInvoicingConfig()]);
    const old = payment.receiptPdfUrl;
    const url = await renderReceiptPdf(payment as PaymentForReceipt, company, config, balanceAfter);
    if (old) {
      removeUploadedFile(old);
      await prisma.document.deleteMany({ where: { fileUrl: old, systemGenerated: true } });
    }
    const stat = fs.statSync(uploadPath(url));
    const [updated] = await prisma.$transaction([
      prisma.payment.update({ where: { id: paymentId }, data: { receiptPdfUrl: url }, include }),
      prisma.document.create({
        data: {
          projectId: payment.projectId,
          type: 'RECEIPT',
          name: `Receipt ${payment.receiptNo ?? paymentId}`,
          fileUrl: url,
          mimeType: 'application/pdf',
          sizeBytes: stat.size,
          uploadedById: userId,
          systemGenerated: true,
        },
      }),
    ]);
    return updated;
  } catch (e) {
    // A failed render must never lose a recorded payment. Surface the payment
    // as-is; GET /:id/receipt will retry the render on demand.
    logger.error({ paymentId, err: e }, 'receipt PDF generation failed');
    return prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include });
  }
}

export default router;
