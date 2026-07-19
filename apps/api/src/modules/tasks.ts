import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, upload } from '../middleware/upload';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

const taskSchema = z.object({
  phase: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'DONE']).optional(),
  completionPct: z.coerce.number().int().min(0).max(100).optional(),
  notes: z.string().nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

/** Recompute overall project progress as the mean of task completion. */
async function syncProjectProgress(projectId: string) {
  const agg = await prisma.task.aggregate({
    where: { projectId },
    _avg: { completionPct: true },
    _count: true,
  });
  if (agg._count > 0) {
    await prisma.project.update({
      where: { id: projectId },
      data: { progressPct: Math.round(agg._avg.completionPct ?? 0) },
    });
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const tasks = await prisma.task.findMany({
      where: { projectId: req.params.projectId },
      include: { photos: true },
      orderBy: [{ phase: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(tasks);
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = taskSchema.parse(req.body);
    const task = await prisma.task.create({
      data: { ...data, projectId: req.params.projectId },
    });
    await syncProjectProgress(req.params.projectId);
    audit(req, 'task.create', 'Task', task.id, { name: task.name });
    res.status(201).json(task);
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = taskSchema.partial().parse(req.body);
    const existing = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    if (data.status === 'DONE' && data.completionPct === undefined) data.completionPct = 100;
    const task = await prisma.task.update({ where: { id: existing.id }, data });
    await syncProjectProgress(req.params.projectId);
    audit(req, 'task.update', 'Task', task.id, { status: task.status, pct: task.completionPct });
    res.json(task);
  }),
);

router.post(
  '/:id/photos',
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('photo file is required');
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task || task.projectId !== req.params.projectId) throw ApiError.notFound();
    const photo = await prisma.taskPhoto.create({
      data: { taskId: task.id, fileUrl: fileUrl(req.file.filename), caption: req.body.caption },
    });
    audit(req, 'task.photo', 'Task', task.id);
    res.status(201).json(photo);
  }),
);

router.delete(
  '/:id',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task || task.projectId !== req.params.projectId) throw ApiError.notFound();
    await prisma.task.delete({ where: { id: task.id } });
    await syncProjectProgress(req.params.projectId);
    audit(req, 'task.delete', 'Task', task.id);
    res.json({ ok: true });
  }),
);

export default router;
