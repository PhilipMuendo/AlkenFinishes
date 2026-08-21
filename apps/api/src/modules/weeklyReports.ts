import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import {
  fileUrl,
  removeUploadedFile,
  signFileUrl,
  upload,
  verifyUploads,
} from '../middleware/upload';
import { aiAvailable, AiError } from '../services/ai';
import { draftWeeklyReport, endOfWeek, factsFor, gatherWeek } from '../services/weeklyReportDraft';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

// Snapped to the Sunday that closes the week, so one week can only ever have
// one report however the client picked the date.
const reportSchema = z.object({
  weekEnding: z.coerce.date().transform(endOfWeek),
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
    const { weekEnding } = z
      .object({ weekEnding: z.coerce.date().transform(endOfWeek) })
      .parse(req.body);
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

/**
 * File the week's report, or revise the one already filed for it.
 *
 * multipart/form-data with up to 6 `photos`; one report per project per week.
 * Filing a second time for the same week replaces the prose and adds any new
 * photos to the ones already there — so the response says which of the two
 * happened (201 created, 200 revised) and the caller can tell the supervisor
 * the truth rather than "filed" both times.
 */
router.post(
  '/',
  upload.array('photos', 6),
  asyncHandler(async (req, res) => {
    const data = reportSchema.parse(req.body);
    await verifyUploads(req.files as Express.Multer.File[]);
    const photoUrls = ((req.files as Express.Multer.File[]) ?? []).map((f) => fileUrl(f.filename));
    const key = { projectId: req.params.projectId, weekEnding: data.weekEnding };
    const existing = await prisma.weeklyReport.findUnique({
      where: { projectId_weekEnding: key },
      select: { id: true },
    });
    const report = await prisma.weeklyReport.upsert({
      where: { projectId_weekEnding: key },
      create: { ...data, ...key, submittedById: req.user!.id, photoUrls },
      update: {
        ...data,
        submittedById: req.user!.id,
        ...(photoUrls.length ? { photoUrls: { push: photoUrls } } : {}),
      },
      include: { submittedBy: { select: { id: true, name: true } } },
    });
    audit(
      req,
      existing ? 'weeklyReport.revise' : 'weeklyReport.submit',
      'WeeklyReport',
      report.id,
      { weekEnding: data.weekEnding },
    );
    res
      .status(existing ? 200 : 201)
      .json({ ...report, photoUrls: report.photoUrls.map((u) => signFileUrl(u)) });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.weeklyReport.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    // The office can clear any week; a supervisor can withdraw one they filed
    // themselves. Same rule as a defect or a safety entry.
    if (req.user!.role !== 'SUPERADMIN' && existing.submittedById !== req.user!.id) {
      throw ApiError.forbidden();
    }
    for (const url of existing.photoUrls) removeUploadedFile(url);
    await prisma.weeklyReport.delete({ where: { id: existing.id } });
    audit(req, 'weeklyReport.delete', 'WeeklyReport', existing.id, {
      weekEnding: existing.weekEnding,
    });
    res.json({ ok: true });
  }),
);

export default router;
