import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { projectScope, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';

const router = Router();
router.use(requireAuth);

const workerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
  trade: z.string().min(1),
  hourlyRate: z.coerce.number().nonnegative(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  biometricId: z.string().nullable().optional(),
});

const include = {
  assignments: {
    where: { endDate: null },
    include: { project: { select: { id: true, name: true } } },
  },
} as const;

// Supervisors see workers currently assigned to their sites; admin sees all.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const where =
      req.user!.role === 'SUPERADMIN'
        ? {}
        : { assignments: { some: { endDate: null, project: projectScope(req.user!) } } };
    res.json(await prisma.worker.findMany({ where, include, orderBy: { name: 'asc' } }));
  }),
);

router.post(
  '/',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const worker = await prisma.worker.create({ data: workerSchema.parse(req.body), include });
    audit(req, 'worker.create', 'Worker', worker.id, { name: worker.name });
    res.status(201).json(worker);
  }),
);

router.patch(
  '/:id',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const worker = await prisma.worker.update({
      where: { id: req.params.id },
      data: workerSchema.partial().parse(req.body),
      include,
    });
    audit(req, 'worker.update', 'Worker', worker.id);
    res.json(worker);
  }),
);

// ---- Assignments: identity is separate from project membership ----

const assignSchema = z.object({
  projectId: z.string().min(1),
  startDate: z.coerce.date().optional(),
});

router.post(
  '/:id/assign',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const { projectId, startDate } = assignSchema.parse(req.body);
    const worker = await prisma.worker.findUnique({ where: { id: req.params.id } });
    if (!worker) throw ApiError.notFound('Worker not found');
    const assignment = await prisma.$transaction(async (tx) => {
      // Close any open assignment before opening a new one.
      await tx.workerAssignment.updateMany({
        where: { workerId: worker.id, endDate: null },
        data: { endDate: new Date() },
      });
      return tx.workerAssignment.create({
        data: { workerId: worker.id, projectId, startDate },
        include: { project: { select: { id: true, name: true } } },
      });
    });
    audit(req, 'worker.assign', 'Worker', worker.id, { projectId });
    res.status(201).json(assignment);
  }),
);

router.post(
  '/:id/unassign',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await prisma.workerAssignment.updateMany({
      where: { workerId: req.params.id, endDate: null },
      data: { endDate: new Date() },
    });
    audit(req, 'worker.unassign', 'Worker', req.params.id);
    res.json({ ok: true });
  }),
);

router.get(
  '/:id/history',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.workerAssignment.findMany({
        where: { workerId: req.params.id },
        include: { project: { select: { id: true, name: true } } },
        orderBy: { startDate: 'desc' },
      }),
    );
  }),
);

export default router;
