import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, signFileUrl, upload, verifyUploads } from '../middleware/upload';
import { aiAvailable, AiError } from '../services/ai';
import { draftDailyReport, factsFor, gatherDay } from '../services/dailyReportDraft';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

const reportSchema = z.object({
  date: z.coerce.date(),
  workCompleted: z.string().min(1),
  workersPresent: z.coerce.number().int().nonnegative(),
  materialsUsed: z.string().optional(),
  challenges: z.string().optional(),
  // All optional — a supervisor should not have to type "none" seven times
  // on an ordinary day for the diary to feel worth filling in.
  weather: z.string().optional(),
  visitors: z.string().optional(),
  materialsDelivered: z.string().optional(),
  instructionsGiven: z.string().optional(),
  delays: z.string().optional(),
  safetyNotes: z.string().optional(),
  equipmentOnSite: z.string().optional(),
});

/**
 * Draft the diary from what the day already recorded.
 *
 * Available to supervisors, unlike the receipt reader: they are the ones who
 * file these, and the whole point is to save them typing at six in the
 * evening on a phone.
 *
 * Writes nothing. The counts come from the database and the prose from the
 * model, and both are returned with the facts they were built from so the
 * supervisor can check the draft rather than trust it. Registered before any
 * /:id route so "draft" is never read as an id.
 */
router.post(
  '/draft',
  asyncHandler(async (req, res) => {
    const { date } = z.object({ date: z.coerce.date() }).parse(req.body);
    if (!aiAvailable()) {
      throw ApiError.badRequest('Report drafting is not switched on for this server.');
    }

    const day = await gatherDay(req.params.projectId, date);
    if (day.empty) {
      // Nothing was recorded, so there is nothing to draft from. Saying so
      // beats inventing a day's work out of an empty database.
      throw ApiError.badRequest(
        'Nothing was recorded on site that day — no attendance, tasks or deliveries. Write the report by hand.',
      );
    }

    try {
      const draft = await draftDailyReport(day);
      audit(req, 'dailyReport.draft', 'DailyReport', 'draft', { date });
      res.json({
        draft,
        // The counts are the database's, never the model's.
        workersPresent: day.workersPresent,
        facts: factsFor(day),
        summary: day,
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
    const reports = await prisma.dailyReport.findMany({
      where: { projectId: req.params.projectId },
      include: { submittedBy: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
      take: 90,
    });
    res.json(reports.map((r) => ({ ...r, photoUrls: r.photoUrls.map((u) => signFileUrl(u)) })));
  }),
);

// multipart/form-data with up to 6 `photos`; one report per project per day (upsert)
router.post(
  '/',
  upload.array('photos', 6),
  asyncHandler(async (req, res) => {
    const data = reportSchema.parse(req.body);
    await verifyUploads(req.files as Express.Multer.File[]);
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
    res.status(201).json({ ...report, photoUrls: report.photoUrls.map((u) => signFileUrl(u)) });
  }),
);

export default router;
