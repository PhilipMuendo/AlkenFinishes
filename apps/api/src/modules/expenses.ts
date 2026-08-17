import { Router } from 'express';
import { z } from 'zod';
import type { BudgetCategory, ExpenseCategory } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import {
  fileUrl,
  removeUploadedFile,
  signFileUrl,
  upload,
  verifyUpload,
} from '../middleware/upload';

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

const expenseSchema = z.object({
  expenseCategory: z.enum(EXPENSE_CATEGORIES),
  amount: z.coerce.number().positive(),
  description: z.string().min(1),
  expenseDate: z.coerce.date(),
});

const include = {
  submittedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
} as const;

const serialize = (e: { receiptUrl: string | null; amount: unknown; [k: string]: unknown }) => ({
  ...e,
  amount: Number(e.amount),
  receiptUrl: signFileUrl(e.receiptUrl),
});

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
      include,
      orderBy: { expenseDate: 'desc' },
      take: 200,
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
    // Money mutation: the audit row commits atomically with the expense.
    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          projectId: req.params.projectId,
          expenseCategory: data.expenseCategory,
          category: EXPENSE_CATEGORY_BUDGET_MAP[data.expenseCategory],
          amount: data.amount,
          description: data.description,
          expenseDate: data.expenseDate,
          submittedById: req.user!.id,
          receiptUrl: req.file ? fileUrl(req.file.filename) : undefined,
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
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!expense || expense.projectId !== req.params.projectId) throw ApiError.notFound();
    await prisma.expense.delete({ where: { id: expense.id } });
    removeUploadedFile(expense.receiptUrl);
    audit(req, 'expense.delete', 'Expense', expense.id, { amount: Number(expense.amount) });
    res.json({ ok: true });
  }),
);

export default router;
