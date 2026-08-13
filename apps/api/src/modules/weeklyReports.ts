import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, signFileUrl, upload, verifyUploads } from '../middleware/upload';
import { aiAvailable, AiError } from '../services/ai';
import { draftWeeklyReport, factsFor, gatherWeek } from '../services/weeklyReportDraft';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

const reportSchema = z.object({
  weekEnding: z.coerce.date(),
  summary: z.string().min(1),
  milestones: z.string().optional(),
  issues: z.string().optional(),
  nextWeekPlan: z.string().optional(),
});

/**
 * Draft the weekly summary from the week's own daily reports.
 *
 * Writes nothing. Registered before any /:id route — this router has none
 * today, but the guard matches dailyReports.ts so "draft" can never be read
 * as a route param if one is added later.
 */
router.post(
  '/draft',
  asyncHandler(async (req, res) => {
    const { weekEnding } = z.object({ weekEnding: z.coerce.date() }).parse(req.body);
    if (!aiAvailable()) {
      throw ApiError.badRequest('Report drafting is not switched on for this server.');
    }

    const week = await gatherWeek(req.params.projectId, weekEnding);
    if (week.empty) {
      throw ApiError.badRequest(
        'No daily reports were filed this week — there is nothing to summarise. Write the weekly report by hand.',
      );
    }

    try {
      const draft = await draftWeeklyReport(week);
      audit(req, 'weeklyReport.draft', 'WeeklyReport', 'draft', { weekEnding });
      res.json({
        draft,
        daysReported: week.daysReported,
        facts: factsFor(week),
      });
    } catch (e) {
      if (e instanceof AiError) {
        throw ApiError.badRequest(e.message, {
          reason: e.reason,
          retryAfterSeconds: e.retryAfterSeconds ?? null,
        });
      }
      throw ApiError.badRequest('The draft could not be written. Fill the report in by hand.');
    }
  }),
);

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
