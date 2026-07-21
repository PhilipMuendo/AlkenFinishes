import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, removeUploadedFile, signFileUrl, upload, verifyUpload } from '../middleware/upload';
import { dueDateHealth } from '../services/payments';

/**
 * Payments are superadmin-only: contract sum, deposit, and payment history
 * are financial data the site supervisor must never see. requireSuperadmin
 * is stacked at the router level (not per-route, unlike expenses.ts) so no
 * route under this resource is ever reachable by a SUPERVISOR.
 */
const router = Router({ mergeParams: true });
router.use(requireAuth, requireSuperadmin, requireProjectAccess);

const include = { submittedBy: { select: { id: true, name: true } } } as const;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const payments = await prisma.payment.findMany({
      where: { projectId: req.params.projectId },
      include,
      orderBy: { paymentDate: 'desc' },
    });
    res.json(payments.map((p) => ({ ...p, receiptUrl: signFileUrl(p.receiptUrl) })));
  }),
);

// Registered before any /:id route.
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const projectId = req.params.projectId;
    const [project, payments] = await Promise.all([
      prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { contractValue: true, balanceDueDate: true },
      }),
      prisma.payment.findMany({
        where: { projectId },
        include,
        orderBy: { paymentDate: 'asc' },
      }),
    ]);
    const deposit = payments.find((p) => p.type === 'DEPOSIT') ?? null;
    const installments = payments.filter((p) => p.type === 'INSTALLMENT');
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
    const contractValue = Number(project.contractValue);
    const pendingBalance = contractValue - totalPaid;

    res.json({
      contractValue,
      totalPaid,
      pendingBalance,
      balanceDueDate: project.balanceDueDate,
      dueDateHealth: dueDateHealth(pendingBalance, project.balanceDueDate),
      deposit: deposit ? { ...deposit, receiptUrl: signFileUrl(deposit.receiptUrl) } : null,
      installments: installments.map((p) => ({ ...p, receiptUrl: signFileUrl(p.receiptUrl) })),
    });
  }),
);

const paymentSchema = z.object({
  type: z.enum(['DEPOSIT', 'INSTALLMENT']),
  amount: z.coerce.number().positive(),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'MPESA', 'CHEQUE', 'OTHER']),
  paymentDate: z.coerce.date(),
  notes: z.string().optional(),
});

// multipart/form-data with optional `receipt` file
router.post(
  '/',
  upload.single('receipt'),
  asyncHandler(async (req, res) => {
    const data = paymentSchema.parse(req.body);
    await verifyUpload(req.file);
    const projectId = req.params.projectId;

    const payment = await prisma.$transaction(async (tx) => {
      if (data.type === 'DEPOSIT') {
        const existing = await tx.payment.findFirst({ where: { projectId, type: 'DEPOSIT' } });
        if (existing) {
          throw ApiError.conflict('A deposit has already been recorded for this project');
        }
      }
      const created = await tx.payment.create({
        data: {
          ...data,
          projectId,
          submittedById: req.user!.id,
          receiptUrl: req.file ? fileUrl(req.file.filename) : undefined,
        },
        include,
      });
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'payment.create',
          entity: 'Payment',
          entityId: created.id,
          meta: { amount: data.amount, type: data.type, method: data.method },
          ip: req.ip,
        },
      });
      return created;
    });
    res.status(201).json({ ...payment, receiptUrl: signFileUrl(payment.receiptUrl) });
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

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!payment || payment.projectId !== req.params.projectId) throw ApiError.notFound();
    await prisma.payment.delete({ where: { id: payment.id } });
    removeUploadedFile(payment.receiptUrl);
    audit(req, 'payment.delete', 'Payment', payment.id, {
      amount: Number(payment.amount),
      type: payment.type,
    });
    res.json({ ok: true });
  }),
);

export default router;
