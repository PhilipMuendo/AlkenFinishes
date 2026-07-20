import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';

const router = Router();
router.use(requireAuth, requireSuperadmin);

const userSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  active: true,
  createdAt: true,
  projects: { select: { id: true, name: true } },
} as const;

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(['SUPERADMIN', 'SUPERVISOR']),
});

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.user.findMany({ select: userSelect, orderBy: { name: 'asc' } }));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash: await bcrypt.hash(data.password, 12),
        name: data.name,
        phone: data.phone,
        role: data.role,
      },
      select: userSelect,
    });
    audit(req, 'user.create', 'User', user.id, { email: user.email, role: user.role });
    res.status(201).json(user);
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = createSchema.partial().parse(req.body);
    const { password, ...rest } = data;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(rest.email ? { email: rest.email.toLowerCase() } : {}),
        ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
        ...(req.body.active !== undefined ? { active: z.boolean().parse(req.body.active) } : {}),
      },
      select: userSelect,
    });
    audit(req, 'user.update', 'User', user.id);
    res.json(user);
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user!.id) throw ApiError.badRequest('Cannot deactivate yourself');
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { active: false },
      select: { id: true },
    });
    audit(req, 'user.deactivate', 'User', user.id);
    res.json({ ok: true });
  }),
);

export default router;
