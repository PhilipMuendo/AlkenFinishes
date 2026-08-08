import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, removeUploadedFile, signFileUrl, upload, verifyUpload } from '../middleware/upload';
import { weightedProgress } from '../services/progress';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

const taskSchema = z.object({
  phase: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'DONE']).optional(),
  completionPct: z.coerce.number().int().min(0).max(100).optional(),
  // Rejected rather than silently coerced: a zero-weight task would be dropped
  // from progress entirely, which is not what anyone typing 0 intends.
  weight: z.coerce.number().positive('Weight must be greater than zero').optional(),
  notes: z.string().nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

/**
 * Recompute overall project progress, weighted by task size.
 *
 * Called after any task mutation. The weighting itself lives in
 * services/progress.ts so it can be reasoned about and tested without a
 * database — see the tests there for what this protects against.
 */
async function syncProjectProgress(projectId: string) {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: { completionPct: true, weight: true },
  });
  if (tasks.length === 0) return;
  const { pct } = weightedProgress(
    tasks.map((t) => ({ completionPct: t.completionPct, weight: Number(t.weight) })),
  );
  await prisma.project.update({ where: { id: projectId }, data: { progressPct: pct } });
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const tasks = await prisma.task.findMany({
      where: { projectId: req.params.projectId },
      include: { photos: true },
      orderBy: [{ phase: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    // The weighting summary comes from the server rather than being recomputed
    // in the browser: one implementation, one set of tests, no chance of the
    // page and the project record disagreeing about the same number.
    const progress = weightedProgress(
      tasks.map((t) => ({ completionPct: t.completionPct, weight: Number(t.weight) })),
    );
    res.json({
      tasks: tasks.map((t) => ({
        ...t,
        weight: Number(t.weight),
        photos: t.photos.map((p) => ({ ...p, fileUrl: signFileUrl(p.fileUrl) })),
      })),
      progress,
    });
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
    await verifyUpload(req.file);
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task || task.projectId !== req.params.projectId) throw ApiError.notFound();
    const photo = await prisma.taskPhoto.create({
      data: { taskId: task.id, fileUrl: fileUrl(req.file.filename), caption: req.body.caption },
    });
    audit(req, 'task.photo', 'Task', task.id);
    res.status(201).json({ ...photo, fileUrl: signFileUrl(photo.fileUrl) });
  }),
);

router.delete(
  '/:id',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: { photos: { select: { fileUrl: true } } },
    });
    if (!task || task.projectId !== req.params.projectId) throw ApiError.notFound();
    await prisma.task.delete({ where: { id: task.id } });
    for (const p of task.photos) removeUploadedFile(p.fileUrl);
    await syncProjectProgress(req.params.projectId);
    audit(req, 'task.delete', 'Task', task.id);
    res.json({ ok: true });
  }),
);

export default router;
