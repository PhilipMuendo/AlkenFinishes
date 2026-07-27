import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { getFinanceSettings } from '../services/finance';

const router = Router();
router.use(requireAuth, requireSuperadmin);

router.get(
  '/thresholds',
  asyncHandler(async (_req, res) => {
    res.json((await getFinanceSettings()).thresholds);
  }),
);

router.get(
  '/finance',
  asyncHandler(async (_req, res) => {
    res.json(await getFinanceSettings());
  }),
);

router.put(
  '/labour-source',
  asyncHandler(async (req, res) => {
    const { labourCostSource } = z
      .object({ labourCostSource: z.enum(['ATTENDANCE', 'EXPENSES', 'BOTH']) })
      .parse(req.body);
    await prisma.setting.upsert({
      where: { key: 'labourCostSource' },
      create: { key: 'labourCostSource', value: labourCostSource },
      update: { value: labourCostSource },
    });
    audit(req, 'settings.labourSource', 'Setting', 'labourCostSource', { labourCostSource });
    res.json({ labourCostSource });
  }),
);

router.put(
  '/thresholds',
  asyncHandler(async (req, res) => {
    const value = z
      .object({
        yellowPct: z.coerce.number().min(1).max(200),
        redPct: z.coerce.number().min(1).max(300),
      })
      .refine((v) => v.redPct > v.yellowPct, { message: 'redPct must exceed yellowPct' })
      .parse(req.body);
    await prisma.setting.upsert({
      where: { key: 'budgetThresholds' },
      create: { key: 'budgetThresholds', value },
      update: { value },
    });
    audit(req, 'settings.thresholds', 'Setting', 'budgetThresholds', value);
    res.json(value);
  }),
);

router.get(
  '/audit-log',
  asyncHandler(async (req, res) => {
    const { page } = z.object({ page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
    const pageSize = 50;
    const items = await prisma.auditLog.findMany({
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    // hasMore is a cheap "did this page fill up" check, not a total count —
    // fine for simple next/prev paging without an extra count() query.
    res.json({ items, page, hasMore: items.length === pageSize });
  }),
);

export default router;
