import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess } from '../middleware/rbac';
import { audit } from '../middleware/audit';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.stockItem.findMany({
        where: { projectId: req.params.projectId },
        // Most recent movement per item, so the list shows activity is
        // actually being captured without opening each item's full history.
        include: {
          movements: {
            orderBy: { date: 'desc' },
            take: 1,
            include: { user: { select: { id: true, name: true } } },
          },
        },
        orderBy: { name: 'asc' },
      }),
    );
  }),
);

const itemSchema = z.object({
  name: z.string().trim().min(1),
  unit: z.string().min(1),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = itemSchema.parse(req.body);
    // The DB constraint only catches an exact byte-for-byte repeat, which
    // "Cement" vs "cement" or a trailing space would slip past — exactly the
    // near-duplicate this list is trying to avoid, so check case-insensitively
    // first and fail with a message that names the clash.
    const clash = await prisma.stockItem.findFirst({
      where: { projectId: req.params.projectId, name: { equals: data.name, mode: 'insensitive' } },
    });
    if (clash) {
      throw ApiError.conflict(`"${clash.name}" is already tracked here — use that item instead.`);
    }
    const item = await prisma.stockItem.create({
      data: { ...data, projectId: req.params.projectId },
    });
    audit(req, 'stock.item.create', 'StockItem', item.id, { name: item.name });
    res.status(201).json(item);
  }),
);

const movementSchema = z.object({
  type: z.enum(['IN', 'OUT', 'ADJUSTMENT']),
  quantity: z.coerce.number().positive(),
  reason: z.string().min(1),
  date: z.coerce.date().optional(),
});

// Every quantity change goes through a movement — items are never edited directly.
router.post(
  '/:itemId/movements',
  asyncHandler(async (req, res) => {
    const data = movementSchema.parse(req.body);
    const item = await prisma.stockItem.findUnique({ where: { id: req.params.itemId } });
    if (!item || item.projectId !== req.params.projectId) throw ApiError.notFound();

    const delta =
      data.type === 'IN'
        ? data.quantity
        : data.type === 'OUT'
          ? -data.quantity
          : data.quantity - Number(item.quantity); // ADJUSTMENT sets absolute quantity

    const newQty = Number(item.quantity) + delta;
    if (newQty < 0) throw ApiError.badRequest('Insufficient stock');

    // Movement, quantity update, and audit commit atomically.
    const [movement] = await prisma.$transaction([
      prisma.stockMovement.create({
        data: {
          stockItemId: item.id,
          type: data.type,
          quantity: data.type === 'ADJUSTMENT' ? Math.abs(delta) : data.quantity,
          reason: data.reason,
          userId: req.user!.id,
          date: data.date,
        },
        include: { user: { select: { id: true, name: true } } },
      }),
      prisma.stockItem.update({
        where: { id: item.id },
        data: { quantity: new Prisma.Decimal(newQty) },
      }),
      prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'stock.movement',
          entity: 'StockItem',
          entityId: item.id,
          meta: { type: data.type, quantity: data.quantity, reason: data.reason },
          ip: req.ip,
        },
      }),
    ]);
    res.status(201).json({ movement, newQuantity: newQty });
  }),
);

router.get(
  '/:itemId/movements',
  asyncHandler(async (req, res) => {
    const item = await prisma.stockItem.findUnique({ where: { id: req.params.itemId } });
    if (!item || item.projectId !== req.params.projectId) throw ApiError.notFound();
    res.json(
      await prisma.stockMovement.findMany({
        where: { stockItemId: item.id },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { date: 'desc' },
        take: 500,
      }),
    );
  }),
);

export default router;
