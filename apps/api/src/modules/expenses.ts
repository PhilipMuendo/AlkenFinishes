import { Router } from 'express';
import { z } from 'zod';
import type { BudgetCategory, ExpenseCategory } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, removeUploadedFile, signFileUrl, upload, verifyUpload } from '../middleware/upload';
import {
  assertPaymentAllowed,
  getPurchaseTaxConfig,
  payablePosition,
  PayableError,
  splitVat,
  withholdingOn,
  type PayablePayment,
} from '../services/payables';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

const EXPENSE_CATEGORIES = [
  'MATERIALS',
  'LABOUR',
  'TRANSPORT',
  'EQUIPMENT_HIRE',
  'SUBCONTRACTOR',
  'SITE_OVERHEADS',
  'OTHER',
] as const;

/**
 * The granular category a claim is filed under maps onto the four budget
 * buckets an owner sets a threshold against. This is the one place that
 * mapping lives — finance.ts and BudgetLine never learn ExpenseCategory
 * exists, so adding an eighth expense category later touches only this file.
 */
export const EXPENSE_CATEGORY_BUDGET_MAP: Record<ExpenseCategory, BudgetCategory> = {
  MATERIALS: 'MATERIALS',
  LABOUR: 'LABOUR',
  TRANSPORT: 'TRANSPORT',
  EQUIPMENT_HIRE: 'OTHER',
  SUBCONTRACTOR: 'OTHER',
  SITE_OVERHEADS: 'OTHER',
  OTHER: 'OTHER',
};

/**
 * multipart/form-data carries every field as a string, and z.coerce.boolean()
 * reads the string "false" as TRUE — every non-empty string is truthy. These
 * helpers are what stop "excludes VAT" being silently read as "includes VAT",
 * which would misstate a cost by the whole VAT rate.
 */
const formBool = z.preprocess(
  (v) => (typeof v === 'string' ? ['true', 'on', '1', 'yes'].includes(v.toLowerCase()) : v),
  z.boolean(),
);
/** An untouched form field arrives as "", which is absent, not a value. */
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalText = z.preprocess(blank, z.string().trim().optional());

const expenseSchema = z.object({
  expenseCategory: z.enum(EXPENSE_CATEGORIES),
  amount: z.coerce.number().positive(),
  description: z.string().min(1),
  expenseDate: z.coerce.date(),

  // Supplier and tax. All optional: a fuel receipt or petty cash has none of
  // it, and must stay as easy to file as it is today.
  supplierId: optionalText,
  supplierInvoiceNo: optionalText,
  dueDate: z.preprocess(blank, z.coerce.date().optional()),
  vatRatePct: z.preprocess(blank, z.coerce.number().min(0).max(100).optional()),
  // Which way the typed `amount` reads. Guessing wrong misstates the cost by
  // the whole VAT rate, so it is asked rather than assumed.
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

/**
 * What a supervisor may see of their own claim.
 *
 * Deliberately NOT the payables side. Whether the office has paid the supplier,
 * in how many instalments, and what tax was withheld is company financial data
 * — the same visibility invoices.ts and payments.ts reserve for the office. A
 * supervisor needs to know their claim was accepted, not what the company owes.
 */
const mineInclude = {
  submittedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
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
  // Only a cost with a supplier is on the payables ledger; everything else has
  // no balance to report, and inventing one would show petty cash as unpaid.
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

// Supervisors can submit expenses (money leaves their hand on site and needs
// a receipt captured there) but not browse the project's full spend history —
// that's financial visibility reserved for the office. They can see their own
// submissions via /mine, so a rejected claim doesn't vanish without a trace.
router.get(
  '/',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const { status } = z
      .object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() })
      .parse(req.query);
    const expenses = await prisma.expense.findMany({
      where: { projectId: req.params.projectId, ...(status && { status }) },
      include,
      orderBy: { expenseDate: 'desc' },
      take: 500,
    });
    res.json(expenses.map(serialize));
  }),
);

router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const expenses = await prisma.expense.findMany({
      where: { projectId: req.params.projectId, submittedById: req.user!.id },
      include: mineInclude,
      orderBy: { expenseDate: 'desc' },
      take: 200,
    });
    // No payments loaded, so serialize() reports no position — a supervisor
    // sees their claim, never the company's payables position on it.
    res.json(expenses.map((e) => ({ ...serialize(e), position: null })));
  }),
);

// multipart/form-data with optional `receipt` file
router.post(
  '/',
  upload.single('receipt'),
  asyncHandler(async (req, res) => {
    const data = expenseSchema.parse(req.body);
    await verifyUpload(req.file);

    // Putting a cost on the payables ledger is an office decision. A
    // supervisor logs what they spent; deciding the company owes a merchant
    // for it — and on what terms — is not theirs to record.
    const isOffice = req.user!.role === 'SUPERADMIN';
    if (data.supplierId && !isOffice) {
      throw ApiError.forbidden('Only the office can put a purchase on the supplier account');
    }
    if (data.supplierId) {
      const supplier = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
      if (!supplier) throw ApiError.badRequest('That supplier is not on the list');
    }

    // `amount` is stored GROSS — what we actually owe the supplier — with the
    // VAT it contains recorded alongside. Which way the typed figure reads is
    // taken from the request, never guessed: reading an ex-VAT figure as
    // inclusive understates the cost by the whole VAT rate.
    const tax = await getPurchaseTaxConfig();
    const vatRatePct = data.supplierId ? (data.vatRatePct ?? 0) : 0;
    const split = splitVat(
      data.amount,
      vatRatePct,
      data.vatInclusive ?? tax.billsIncludeVat,
    );

    // Money mutation: the audit row commits atomically with the expense.
    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          projectId: req.params.projectId,
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
          action: 'expense.create',
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
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    if (existing.status !== 'PENDING') {
      throw ApiError.conflict(`This claim has already been ${existing.status.toLowerCase()}`);
    }
    const expense = await prisma.expense.update({
      where: { id: existing.id },
      data: { status: 'APPROVED', approvedById: req.user!.id, approvedAt: new Date() },
      include,
    });
    audit(req, 'expense.approve', 'Expense', expense.id, { amount: Number(expense.amount) });
    res.json(serialize(expense));
  }),
);

router.post(
  '/:id/reject',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().min(3, 'Give a reason') }).parse(req.body);
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
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
    audit(req, 'expense.reject', 'Expense', expense.id, { reason });
    res.json(serialize(expense));
  }),
);

router.delete(
  '/:id',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: { payments: { select: { id: true, proofUrl: true } } },
    });
    if (!expense || expense.projectId !== req.params.projectId) throw ApiError.notFound();
    // Deleting a cost that has been part-paid would take its payments with it
    // (ON DELETE CASCADE) and silently erase money that actually left the bank.
    if (expense.payments.length > 0) {
      throw ApiError.conflict(
        `This bill has ${expense.payments.length} payment(s) recorded against it. Remove those first if it really was never incurred.`,
      );
    }
    await prisma.expense.delete({ where: { id: expense.id } });
    removeUploadedFile(expense.receiptUrl);
    audit(req, 'expense.delete', 'Expense', expense.id, { amount: Number(expense.amount) });
    res.json({ ok: true });
  }),
);

// ---- Supplier payments: settling what is owed on a cost ----

const paymentSchema = z.object({
  amount: z.coerce.number().nonnegative('A payment cannot be negative'),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'MPESA', 'CHEQUE', 'OTHER']),
  paymentDate: z.coerce.date(),
  referenceNo: optionalText,
  notes: optionalText,
  // Tax deducted from this payment and owed to KRA rather than the supplier.
  whtAmount: z.preprocess(blank, z.coerce.number().nonnegative().optional()),
  whtVatAmount: z.preprocess(blank, z.coerce.number().nonnegative().optional()),
  whtCertNo: optionalText,
  // Only set when the bank statement genuinely says more went out.
  allowOverpayment: z.preprocess((v) => blank(v) ?? false, formBool),
});

/**
 * What a payment on this bill should look like before anything is typed.
 *
 * Withholding is computed on the EX-VAT value of what is still outstanding,
 * never on the gross: applying the rate to a VAT-inclusive figure takes money
 * from a supplier that KRA never asked for.
 */
router.get(
  '/:id/payment-suggestion',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: { payments: true },
    });
    if (!expense || expense.projectId !== req.params.projectId) throw ApiError.notFound();

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

    // The ex-VAT slice of what is left, which is the base withholding bites on.
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
        // Settle the bill in full: cash is the balance less whatever is withheld.
        whtAmount: wht,
        whtVatAmount: whtVat,
        amount: Math.max(0, Math.round((position.outstanding - wht - whtVat) * 100) / 100),
      },
    });
  }),
);

router.post(
  '/:id/payments',
  requireSuperadmin,
  upload.single('proof'),
  asyncHandler(async (req, res) => {
    const data = paymentSchema.parse(req.body);
    await verifyUpload(req.file);

    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: { payments: true },
    });
    if (!expense || expense.projectId !== req.params.projectId) throw ApiError.notFound();

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
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const payment = await prisma.supplierPayment.findUnique({
      where: { id: req.params.paymentId },
      include: { expense: { select: { id: true, projectId: true } } },
    });
    if (
      !payment ||
      payment.expenseId !== req.params.id ||
      payment.expense.projectId !== req.params.projectId
    ) {
      throw ApiError.notFound();
    }
    // Withheld tax already remitted to KRA cannot be unwound by deleting the
    // row it was recorded on — the money is gone and the certificate issued.
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
