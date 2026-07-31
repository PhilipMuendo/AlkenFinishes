import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';

/**
 * A supervisor asks for materials; the office decides; fulfilment logs an
 * ordinary StockMovement IN. The request itself never moves stock — "what was
 * asked for" and "what actually arrived" are kept as two separate facts,
 * because they routinely differ (short delivery, substitution, price change).
 */
const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

const requestSchema = z.object({
  itemName: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unit: z.string().min(1),
  neededBy: z.coerce.date().optional(),
  notes: z.string().optional(),
});

const include = {
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} as const;

const serialize = (r: { quantity: unknown; [k: string]: unknown }) => ({
  ...r,
  quantity: Number(r.quantity),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status } = z
      .object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'FULFILLED']).optional() })
      .parse(req.query);
    const requests = await prisma.materialRequest.findMany({
      where: { projectId: req.params.projectId, ...(status && { status }) },
      include,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    res.json(requests.map(serialize));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = requestSchema.parse(req.body);
    const request = await prisma.materialRequest.create({
      data: { ...data, projectId: req.params.projectId, requestedById: req.user!.id },
      include,
    });
    audit(req, 'materialRequest.create', 'MaterialRequest', request.id, {
      itemName: request.itemName,
      quantity: Number(request.quantity),
    });
    res.status(201).json(serialize(request));
  }),
);

router.post(
  '/:id/approve',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const existing = await prisma.materialRequest.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    if (existing.status !== 'PENDING') {
      throw ApiError.conflict(`This request has already been ${existing.status.toLowerCase()}`);
    }
    const request = await prisma.materialRequest.update({
      where: { id: existing.id },
      data: { status: 'APPROVED', decidedById: req.user!.id, decidedAt: new Date() },
      include,
    });
    audit(req, 'materialRequest.approve', 'MaterialRequest', request.id);
    res.json(serialize(request));
  }),
);

router.post(
  '/:id/reject',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().min(3, 'Give a reason') }).parse(req.body);
    const existing = await prisma.materialRequest.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    if (existing.status !== 'PENDING') {
      throw ApiError.conflict(`This request has already been ${existing.status.toLowerCase()}`);
    }
    const request = await prisma.materialRequest.update({
      where: { id: existing.id },
      data: {
        status: 'REJECTED',
        decidedById: req.user!.id,
        decidedAt: new Date(),
        rejectReason: reason,
      },
      include,
    });
    audit(req, 'materialRequest.reject', 'MaterialRequest', request.id, { reason });
    res.json(serialize(request));
  }),
);

/**
 * Fulfil: the material has arrived. This finds-or-creates a StockItem by
 * (project, name) — matching the unique constraint stock.ts already relies
 * on — and logs a normal IN movement, so the fulfilled quantity flows through
 * the same stock ledger every other receipt does.
 */
router.post(
  '/:id/fulfil',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const { quantity } = z
      .object({ quantity: z.coerce.number().positive().optional() })
      .parse(req.body);
    const existing = await prisma.materialRequest.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    if (existing.status !== 'APPROVED') {
      throw ApiError.conflict('Only an approved request can be marked fulfilled');
    }
    const receivedQty = quantity ?? Number(existing.quantity);

    const request = await prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.upsert({
        where: { projectId_name: { projectId: existing.projectId, name: existing.itemName } },
        create: { projectId: existing.projectId, name: existing.itemName, unit: existing.unit },
        update: {},
      });
      await tx.stockMovement.create({
        data: {
          stockItemId: item.id,
          type: 'IN',
          quantity: receivedQty,
          reason: `Material request fulfilled: ${existing.itemName}`,
          userId: req.user!.id,
        },
      });
      await tx.stockItem.update({
        where: { id: item.id },
        data: { quantity: new Prisma.Decimal(Number(item.quantity) + receivedQty) },
      });
      return tx.materialRequest.update({
        where: { id: existing.id },
        data: { status: 'FULFILLED', fulfilledAt: new Date() },
        include,
      });
    });
    audit(req, 'materialRequest.fulfil', 'MaterialRequest', request.id, { quantity: receivedQty });
    res.json(serialize(request));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.materialRequest.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    if (existing.status !== 'PENDING') {
      throw ApiError.conflict('Only a pending request can be withdrawn');
    }
    // A supervisor may withdraw their own request; the office can clear any.
    if (req.user!.role !== 'SUPERADMIN' && existing.requestedById !== req.user!.id) {
      throw ApiError.forbidden();
    }
    await prisma.materialRequest.delete({ where: { id: existing.id } });
    audit(req, 'materialRequest.delete', 'MaterialRequest', existing.id);
    res.json({ ok: true });
  }),
);

export default router;
