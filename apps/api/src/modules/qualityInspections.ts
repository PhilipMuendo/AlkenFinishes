import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, removeUploadedFile, signFileUrl, upload, verifyUploads } from '../middleware/upload';
import {
  blankChecklist,
  DEFAULT_CHECKLIST_NAME,
  overallStatus,
  QUALITY_CHECKLISTS,
  type QualityChecklistItem,
} from '../services/qualityChecklists';

/**
 * Quality Inspection: the standing checklist, run per area as work reaches
 * each stage — "checked continuously, not only at the end". `items` is
 * always the full checklist array; a partial re-submission would silently
 * drop the points nobody touched, so every write replaces the whole thing.
 */
const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

const itemSchema = z.object({
  label: z.string().min(1),
  status: z.enum(['PENDING', 'PASS', 'FAIL']),
});

const MAX_PHOTOS = 6;

const include = {
  inspectedBy: { select: { id: true, name: true } },
  task: { select: { id: true, phase: true, name: true } },
};

router.get(
  '/checklists',
  asyncHandler(async (_req, res) => {
    res.json({ names: Object.keys(QUALITY_CHECKLISTS), default: DEFAULT_CHECKLIST_NAME });
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const inspections = await prisma.qualityInspection.findMany({
      where: { projectId: req.params.projectId },
      include,
      orderBy: { inspectedAt: 'desc' },
      take: 200,
    });
    res.json(inspections.map((i) => ({ ...i, photoUrls: i.photoUrls.map((u) => signFileUrl(u)) })));
  }),
);

router.post(
  '/',
  upload.array('photos', MAX_PHOTOS),
  asyncHandler(async (req, res) => {
    const { area, checklistName, taskId, notes } = z
      .object({
        area: z.string().trim().min(1, 'Say which area this inspection covers'),
        checklistName: z.string().trim().default(DEFAULT_CHECKLIST_NAME),
        taskId: z.string().optional(),
        notes: z.string().trim().optional(),
      })
      .parse(req.body);

    if (taskId) {
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task || task.projectId !== req.params.projectId) {
        throw ApiError.badRequest('That task is not on this site');
      }
    }

    await verifyUploads(req.files as Express.Multer.File[]);
    const photoUrls = ((req.files as Express.Multer.File[]) ?? []).map((f) => fileUrl(f.filename));
    const items = blankChecklist(checklistName);

    const inspection = await prisma.qualityInspection.create({
      data: {
        projectId: req.params.projectId,
        taskId: taskId || null,
        area,
        checklistName,
        items: items as object,
        overallStatus: overallStatus(items),
        notes,
        photoUrls,
        inspectedById: req.user!.id,
      },
      include,
    });
    audit(req, 'qualityInspection.create', 'QualityInspection', inspection.id, { area });
    res.status(201).json({ ...inspection, photoUrls: inspection.photoUrls.map((u) => signFileUrl(u)) });
  }),
);

router.patch(
  '/:id',
  upload.array('photos', MAX_PHOTOS),
  asyncHandler(async (req, res) => {
    const existing = await prisma.qualityInspection.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();

    // Must be exactly the checklist this inspection was started with — no
    // more, no fewer, no relabelling — or a submission could silently
    // replace the real points with fabricated ones. Same class of gap as
    // the handover/closeout item-label validation fixed earlier.
    const expectedLabels = QUALITY_CHECKLISTS[existing.checklistName] ?? QUALITY_CHECKLISTS[DEFAULT_CHECKLIST_NAME];
    const { items, notes, area } = z
      .object({
        items: z
          .string()
          .transform((v) => JSON.parse(v) as unknown)
          .pipe(
            z
              .array(itemSchema)
              .length(expectedLabels.length)
              .refine(
                (v) => new Set(v.map((i) => i.label)).size === expectedLabels.length,
                'Each checklist item must appear exactly once',
              )
              .refine(
                (v) => v.every((i) => (expectedLabels as readonly string[]).includes(i.label)),
                'Every item must be one of this checklist’s own points',
              ),
          ),
        notes: z.string().trim().nullable().optional(),
        area: z.string().trim().min(1).optional(),
      })
      .parse(req.body);

    await verifyUploads(req.files as Express.Multer.File[]);
    const newPhotoUrls = ((req.files as Express.Multer.File[]) ?? []).map((f) => fileUrl(f.filename));

    const typedItems: QualityChecklistItem[] = items;
    const inspection = await prisma.qualityInspection.update({
      where: { id: existing.id },
      data: {
        items: typedItems as object,
        overallStatus: overallStatus(typedItems),
        ...(notes !== undefined && { notes }),
        ...(area && { area }),
        ...(newPhotoUrls.length && { photoUrls: { push: newPhotoUrls } }),
      },
      include,
    });
    audit(req, 'qualityInspection.update', 'QualityInspection', inspection.id, {
      overallStatus: inspection.overallStatus,
    });
    res.json({ ...inspection, photoUrls: inspection.photoUrls.map((u) => signFileUrl(u)) });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.qualityInspection.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    if (req.user!.role !== 'SUPERADMIN' && existing.inspectedById !== req.user!.id) {
      throw ApiError.forbidden();
    }
    for (const url of existing.photoUrls) removeUploadedFile(url);
    await prisma.qualityInspection.delete({ where: { id: existing.id } });
    audit(req, 'qualityInspection.delete', 'QualityInspection', existing.id, {});
    res.json({ ok: true });
  }),
);

export default router;
