import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { getThresholds } from '../services/finance';

const router = Router();
router.use(requireAuth, requireSuperadmin);

router.get(
  '/thresholds',
  asyncHandler(async (_req, res) => {
    res.json(await getThresholds());
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
    res.json(
      await prisma.auditLog.findMany({
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    );
  }),
);

export default router;
