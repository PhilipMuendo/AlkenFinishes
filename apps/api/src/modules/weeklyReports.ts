import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, signFileUrl, upload, verifyUploads } from '../middleware/upload';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

const reportSchema = z.object({
  weekEnding: z.coerce.date(),
  summary: z.string().min(1),
  milestones: z.string().optional(),
  issues: z.string().optional(),
  nextWeekPlan: z.string().optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const reports = await prisma.weeklyReport.findMany({
      where: { projectId: req.params.projectId },
      include: { submittedBy: { select: { id: true, name: true } } },
      orderBy: { weekEnding: 'desc' },
      take: 52,
    });
    res.json(reports.map((r) => ({ ...r, photoUrls: r.photoUrls.map((u) => signFileUrl(u)) })));
  }),
);

// multipart/form-data with up to 6 `photos`; one report per project per week (upsert)
router.post(
  '/',
  upload.array('photos', 6),
  asyncHandler(async (req, res) => {
    const data = reportSchema.parse(req.body);
    await verifyUploads(req.files as Express.Multer.File[]);
    const photoUrls = ((req.files as Express.Multer.File[]) ?? []).map((f) => fileUrl(f.filename));
    const report = await prisma.weeklyReport.upsert({
      where: {
        projectId_weekEnding: { projectId: req.params.projectId, weekEnding: data.weekEnding },
      },
      create: {
        ...data,
        projectId: req.params.projectId,
        submittedById: req.user!.id,
        photoUrls,
      },
      update: { ...data, ...(photoUrls.length ? { photoUrls: { push: photoUrls } } : {}) },
      include: { submittedBy: { select: { id: true, name: true } } },
    });
    audit(req, 'weeklyReport.submit', 'WeeklyReport', report.id, { weekEnding: data.weekEnding });
    res.status(201).json({ ...report, photoUrls: report.photoUrls.map((u) => signFileUrl(u)) });
  }),
);

export default router;
