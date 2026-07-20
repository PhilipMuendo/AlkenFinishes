import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, removeUploadedFile, signFileUrl, upload, verifyUpload } from '../middleware/upload';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

const expenseSchema = z.object({
  category: z.enum(['MATERIALS', 'LABOUR', 'TRANSPORT', 'OTHER']),
  amount: z.coerce.number().positive(),
  description: z.string().min(1),
  expenseDate: z.coerce.date(),
});

const include = { submittedBy: { select: { id: true, name: true } } } as const;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const expenses = await prisma.expense.findMany({
      where: { projectId: req.params.projectId },
      include,
      orderBy: { expenseDate: 'desc' },
      take: 500,
    });
    res.json(expenses.map((e) => ({ ...e, receiptUrl: signFileUrl(e.receiptUrl) })));
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
          ...data,
          projectId: req.params.projectId,
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
          meta: { amount: data.amount, category: data.category },
          ip: req.ip,
        },
      });
      return created;
    });
    res.status(201).json({ ...expense, receiptUrl: signFileUrl(expense.receiptUrl) });
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
