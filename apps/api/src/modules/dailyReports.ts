import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, upload } from '../middleware/upload';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

const reportSchema = z.object({
  date: z.coerce.date(),
  workCompleted: z.string().min(1),
  workersPresent: z.coerce.number().int().nonnegative(),
  materialsUsed: z.string().optional(),
  challenges: z.string().optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.dailyReport.findMany({
        where: { projectId: req.params.projectId },
        include: { submittedBy: { select: { id: true, name: true } } },
        orderBy: { date: 'desc' },
        take: 90,
      }),
    );
  }),
);

// multipart/form-data with up to 6 `photos`; one report per project per day (upsert)
router.post(
  '/',
  upload.array('photos', 6),
  asyncHandler(async (req, res) => {
    const data = reportSchema.parse(req.body);
    const photoUrls = ((req.files as Express.Multer.File[]) ?? []).map((f) => fileUrl(f.filename));
    const report = await prisma.dailyReport.upsert({
      where: {
        projectId_date: { projectId: req.params.projectId, date: data.date },
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
    audit(req, 'dailyReport.submit', 'DailyReport', report.id, { date: data.date });
    res.status(201).json(report);
  }),
);

export default router;
