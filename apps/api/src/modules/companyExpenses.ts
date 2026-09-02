import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireFinanceRole } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, removeUploadedFile, signFileUrl, upload, verifyUpload } from '../middleware/upload';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';
import {
  ExtractionError,
  findPossibleDuplicate,
  matchSupplier,
  receiptScanningAvailable,
  scanReceipt,
  verify,
} from '../services/receiptExtraction';
import {
  assertPaymentAllowed,
  getPurchaseTaxConfig,
  payablePosition,
  PayableError,
  splitVat,
  withholdingOn,
  type PayablePayment,
} from '../services/payables';
import { EXPENSE_CATEGORY_BUDGET_MAP } from './expenses';

/**
 * Spend that isn't tied to any site — uniforms for the fundis, office
 * supplies, tools bought ahead of a future contract. It rides the same
 * approval/VAT/payables machinery as a site expense (see expenses.ts, which
 * this module deliberately mirrors), but with no project to scope it to:
 * gated purely on finance role, and every row here always has
 * `projectId: null`. Every route below re-checks that on the id it is
 * handed, so this router can never read or touch a site's expenses even if
 * someone guesses an id — the equivalent of expenses.ts's
 * `existing.projectId !== req.params.projectId` ownership check.
 */
const router = Router();
router.use(requireAuth, requireFinanceRole);

const EXPENSE_CATEGORIES = [
  'MATERIALS',
  'LABOUR',
  'TRANSPORT',
  'EQUIPMENT_HIRE',
  'SUBCONTRACTOR',
  'SITE_OVERHEADS',
  'OTHER',
] as const;

const formBool = z.preprocess(
  (v) => (typeof v === 'string' ? ['true', 'on', '1', 'yes'].includes(v.toLowerCase()) : v),
  z.boolean(),
);
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalText = z.preprocess(blank, z.string().trim().optional());

const expenseSchema = z.object({
  expenseCategory: z.enum(EXPENSE_CATEGORIES),
  amount: z.coerce.number().positive(),
  description: z.string().min(1),
  expenseDate: z.coerce.date(),

  supplierId: optionalText,
  supplierInvoiceNo: optionalText,
  dueDate: z.preprocess(blank, z.coerce.date().optional()),
  vatRatePct: z.preprocess(blank, z.coerce.number().min(0).max(100).optional()),
  vatInclusive: z.preprocess(blank, formBool.optional()),
  taxInvoice: z.preprocess(blank, formBool.optional()),
});

const include = {
  submittedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  payments: {
    orderBy: { paymentDate: 'desc' as const },
    include: { paidBy: { select: { id: true, name: true } } },
  },
} as const;

type PaymentRow = {
  amount: unknown;
  whtAmount: unknown;
  whtVatAmount: unknown;
  proofUrl?: string | null;
  [k: string]: unknown;
};

const serializePayment = (p: PaymentRow) => ({
  ...p,
  amount: Number(p.amount),
  whtAmount: Number(p.whtAmount),
  whtVatAmount: Number(p.whtVatAmount),
  proofUrl: signFileUrl(p.proofUrl ?? null),
});

const serialize = (e: {
  receiptUrl: string | null;
  amount: unknown;
  vatAmount?: unknown;
  supplierId?: string | null;
  dueDate?: Date | null;
  expenseDate?: Date;
  taxInvoice?: boolean;
  payments?: PaymentRow[];
  [k: string]: unknown;
}) => {
  const payments = (e.payments ?? []).map(serializePayment);
  const base = {
    ...e,
    amount: Number(e.amount),
    vatAmount: Number(e.vatAmount ?? 0),
    receiptUrl: signFileUrl(e.receiptUrl),
    payments,
  };
  if (e.supplierId == null) return { ...base, position: null };
  return {
    ...base,
    position: payablePosition(
      {
        id: String(e.id),
        supplierId: e.supplierId,
        amount: base.amount,
        vatAmount: base.vatAmount,
        taxInvoice: e.taxInvoice ?? false,
        dueDate: e.dueDate ?? null,
        expenseDate: e.expenseDate ?? new Date(),
      },
      payments,
    ),
  };
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status } = z
      .object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() })
      .parse(req.query);
    const expenses = await prisma.expense.findMany({
      where: { projectId: null, ...(status && { status }) },
      include,
      orderBy: { expenseDate: 'desc' },
      take: 500,
    });
    res.json(expenses.map(serialize));
  }),
);

// multipart/form-data with optional `receipt` file
router.post(
  '/',
  upload.single('receipt'),
  asyncHandler(async (req, res) => {
    const data = expenseSchema.parse(req.body);
    await verifyUpload(req.file);

    if (data.supplierId) {
      const supplier = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
      if (!supplier) throw ApiError.badRequest('That supplier is not on the list');
    }

    const tax = await getPurchaseTaxConfig();
    const vatRatePct = data.supplierId ? (data.vatRatePct ?? 0) : 0;
    const split = splitVat(data.amount, vatRatePct, data.vatInclusive ?? tax.billsIncludeVat);

    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          projectId: null,
          expenseCategory: data.expenseCategory,
          category: EXPENSE_CATEGORY_BUDGET_MAP[data.expenseCategory],
          amount: split.gross,
          description: data.description,
          expenseDate: data.expenseDate,
          submittedById: req.user!.id,
          receiptUrl: req.file ? fileUrl(req.file.filename) : undefined,
          supplierId: data.supplierId,
          supplierInvoiceNo: data.supplierInvoiceNo,
          dueDate: data.dueDate,
          vatRatePct,
          vatAmount: split.vat,
          taxInvoice: data.taxInvoice ?? false,
        },
        include,
      });
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'companyExpense.create',
          entity: 'Expense',
          entityId: created.id,
          meta: { amount: data.amount, expenseCategory: data.expenseCategory },
          ip: req.ip,
        },
      });
      return created;
    });
    res.status(201).json(serialize(expense));
  }),
);

router.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== null) throw ApiError.notFound();
    if (existing.status !== 'PENDING') {
      throw ApiError.conflict(`This claim has already been ${existing.status.toLowerCase()}`);
    }
    const expense = await prisma.expense.update({
      where: { id: existing.id },
      data: { status: 'APPROVED', approvedById: req.user!.id, approvedAt: new Date() },
      include,
    });
    audit(req, 'companyExpense.approve', 'Expense', expense.id, { amount: Number(expense.amount) });
    res.json(serialize(expense));
  }),
);

router.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().min(3, 'Give a reason') }).parse(req.body);
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== null) throw ApiError.notFound();
    if (existing.status !== 'PENDING') {
      throw ApiError.conflict(`This claim has already been ${existing.status.toLowerCase()}`);
    }
    const expense = await prisma.expense.update({
      where: { id: existing.id },
      data: {
        status: 'REJECTED',
        approvedById: req.user!.id,
        approvedAt: new Date(),
        rejectReason: reason,
      },
      include,
    });
    audit(req, 'companyExpense.reject', 'Expense', expense.id, { reason });
    res.json(serialize(expense));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: { payments: { select: { id: true, proofUrl: true } } },
    });
    if (!expense || expense.projectId !== null) throw ApiError.notFound();
    if (expense.payments.length > 0) {
      throw ApiError.conflict(
        `This bill has ${expense.payments.length} payment(s) recorded against it. Remove those first if it really was never incurred.`,
      );
    }
    await prisma.expense.delete({ where: { id: expense.id } });
    removeUploadedFile(expense.receiptUrl);
    audit(req, 'companyExpense.delete', 'Expense', expense.id, { amount: Number(expense.amount) });
    res.json({ ok: true });
  }),
);

// ---- Reading a receipt ----

router.post(
  '/scan-receipt',
  upload.single('receipt'),
  asyncHandler(async (req, res) => {
    if (!receiptScanningAvailable()) {
      throw ApiError.badRequest(
        'Receipt reading is not switched on. Set ANTHROPIC_API_KEY on the server to use it.',
      );
    }
    if (!req.file) throw ApiError.badRequest('Attach a photo of the receipt');
    await verifyUpload(req.file);

    const filePath = path.join(env.UPLOAD_DIR, req.file.filename);
    try {
      const buffer = await fs.promises.readFile(filePath);
      const extracted = await scanReceipt(buffer, req.file.mimetype);
      const tax = await getPurchaseTaxConfig();
      const result = verify(extracted, tax.vatRatePct);

      const suppliers = await prisma.supplier.findMany({
        where: { active: true },
        select: { id: true, name: true },
      });
      const supplier = matchSupplier(extracted.supplierName, suppliers);

      const duplicate = await findPossibleDuplicate(
        result.suggested.amount,
        extracted.date,
        supplier?.id ?? null,
      );
      if (duplicate) {
        result.checks.push(duplicate);
        result.needsReview = true;
      }

      audit(req, 'companyExpense.scanReceipt', 'Expense', 'draft', {
        matched: !!supplier,
        needsReview: result.needsReview,
      });
      res.json({ ...result, supplier, supplierUnmatched: !supplier && !!extracted.supplierName });
    } catch (e) {
      if (e instanceof ExtractionError) {
        throw ApiError.badRequest(e.message, {
          reason: e.reason,
          retryAfterSeconds: e.retryAfterSeconds ?? null,
        });
      }
      throw e;
    } finally {
      removeUploadedFile(fileUrl(req.file.filename));
    }
  }),
);

// ---- Supplier payments: settling what is owed on a cost ----

const paymentSchema = z.object({
  amount: z.coerce.number().nonnegative('A payment cannot be negative'),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'MPESA', 'CHEQUE', 'OTHER']),
  paymentDate: z.coerce.date(),
  referenceNo: optionalText,
  notes: optionalText,
  whtAmount: z.preprocess(blank, z.coerce.number().nonnegative().optional()),
  whtVatAmount: z.preprocess(blank, z.coerce.number().nonnegative().optional()),
  whtCertNo: optionalText,
  allowOverpayment: z.preprocess((v) => blank(v) ?? false, formBool),
});

router.get(
  '/:id/payment-suggestion',
  asyncHandler(async (req, res) => {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: { payments: true },
    });
    if (!expense || expense.projectId !== null) throw ApiError.notFound();

    const tax = await getPurchaseTaxConfig();
    const position = payablePosition(
      {
        id: expense.id,
        supplierId: expense.supplierId,
        amount: Number(expense.amount),
        vatAmount: Number(expense.vatAmount),
        taxInvoice: expense.taxInvoice,
        dueDate: expense.dueDate,
        expenseDate: expense.expenseDate,
      },
      expense.payments.map((p) => ({
        amount: Number(p.amount),
        whtAmount: Number(p.whtAmount),
        whtVatAmount: Number(p.whtVatAmount),
      })),
    );

    const outstandingNet =
      position.amount > 0
        ? Math.round(position.outstanding * (position.netAmount / position.amount) * 100) / 100
        : 0;
    const wht = tax.withholdingAgent ? withholdingOn(outstandingNet, tax.defaultWhtRatePct) : 0;
    const whtVat = tax.withholdingAgent
      ? withholdingOn(outstandingNet, tax.defaultWhtVatRatePct)
      : 0;

    res.json({
      position,
      tax,
      outstandingNet,
      suggested: {
        whtAmount: wht,
        whtVatAmount: whtVat,
        amount: Math.max(0, Math.round((position.outstanding - wht - whtVat) * 100) / 100),
      },
    });
  }),
);

router.post(
  '/:id/payments',
  upload.single('proof'),
  asyncHandler(async (req, res) => {
    const data = paymentSchema.parse(req.body);
    await verifyUpload(req.file);

    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: { payments: true },
    });
    if (!expense || expense.projectId !== null) throw ApiError.notFound();

    const payment: PayablePayment = {
      amount: data.amount,
      whtAmount: data.whtAmount ?? 0,
      whtVatAmount: data.whtVatAmount ?? 0,
    };
    try {
      assertPaymentAllowed(
        {
          id: expense.id,
          supplierId: expense.supplierId,
          amount: Number(expense.amount),
          vatAmount: Number(expense.vatAmount),
          taxInvoice: expense.taxInvoice,
          dueDate: expense.dueDate,
          expenseDate: expense.expenseDate,
        },
        expense.payments.map((p) => ({
          amount: Number(p.amount),
          whtAmount: Number(p.whtAmount),
          whtVatAmount: Number(p.whtVatAmount),
        })),
        payment,
        { allowOverpayment: data.allowOverpayment },
      );
    } catch (e) {
      if (e instanceof PayableError) throw ApiError.badRequest(e.message);
      throw e;
    }

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.supplierPayment.create({
        data: {
          expenseId: expense.id,
          amount: data.amount,
          method: data.method,
          paymentDate: data.paymentDate,
          referenceNo: data.referenceNo,
          notes: data.notes,
          whtAmount: payment.whtAmount,
          whtVatAmount: payment.whtVatAmount,
          whtCertNo: data.whtCertNo,
          proofUrl: req.file ? fileUrl(req.file.filename) : undefined,
          paidById: req.user!.id,
        },
        include: { paidBy: { select: { id: true, name: true } } },
      });
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'supplierPayment.create',
          entity: 'SupplierPayment',
          entityId: row.id,
          meta: {
            expenseId: expense.id,
            amount: data.amount,
            whtAmount: payment.whtAmount,
            whtVatAmount: payment.whtVatAmount,
          },
          ip: req.ip,
        },
      });
      return row;
    });

    res.status(201).json(serializePayment(created));
  }),
);

router.delete(
  '/:id/payments/:paymentId',
  asyncHandler(async (req, res) => {
    const payment = await prisma.supplierPayment.findUnique({
      where: { id: req.params.paymentId },
      include: { expense: { select: { id: true, projectId: true } } },
    });
    if (!payment || payment.expenseId !== req.params.id || payment.expense.projectId !== null) {
      throw ApiError.notFound();
    }
    if (payment.whtRemittedAt) {
      throw ApiError.conflict(
        'The tax withheld on this payment has already been remitted to KRA. Record a correcting entry instead of deleting it.',
      );
    }
    await prisma.supplierPayment.delete({ where: { id: payment.id } });
    removeUploadedFile(payment.proofUrl);
    audit(req, 'supplierPayment.delete', 'SupplierPayment', payment.id, {
      expenseId: payment.expenseId,
      amount: Number(payment.amount),
    });
    res.json({ ok: true });
  }),
);

export default router;
