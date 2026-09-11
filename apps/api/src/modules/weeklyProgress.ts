import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { signFileUrl } from '../middleware/upload';
import { computeWeeklyProgress, renderWeeklyProgressPdf, type WeeklyProgressData } from '../services/weeklyProgress';
import { endOfWeek } from '../services/weeklyReportDraft';

/**
 * Weekly Planned vs Actual reports. `/preview` computes live and saves
 * nothing — the supervisor reviews it before deciding to finalise. Filing
 * (`POST /`) freezes that computation into a row, the same way a VAT filing
 * freezes a month's net-payable figure: what gets stored is what the table
 * showed at the moment someone finalised it, not a live query that would
 * silently change as more expenses land against the project.
 */
const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

router.get(
  '/preview',
  asyncHandler(async (req, res) => {
    const { weekEnding } = z
      .object({ weekEnding: z.coerce.date().transform(endOfWeek) })
      .parse(req.query);
    res.json(await computeWeeklyProgress(req.params.projectId, weekEnding));
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const reports = await prisma.weeklyProgressReport.findMany({
      where: { projectId: req.params.projectId },
      include: { generatedBy: { select: { id: true, name: true } } },
      orderBy: { weekEnding: 'desc' },
      take: 52,
    });
    res.json(
      reports.map((r) => ({ ...r, pdfUrl: r.pdfUrl ? signFileUrl(r.pdfUrl) : null })),
    );
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { weekEnding } = z
      .object({ weekEnding: z.coerce.date().transform(endOfWeek) })
      .parse(req.body);

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: req.params.projectId },
      select: { name: true },
    });
    const data: WeeklyProgressData = await computeWeeklyProgress(req.params.projectId, weekEnding);
    const pdfUrl = await renderWeeklyProgressPdf(project.name, data);

    const key = { projectId: req.params.projectId, weekEnding };
    const existing = await prisma.weeklyProgressReport.findUnique({
      where: { projectId_weekEnding: key },
      select: { id: true },
    });
    const report = await prisma.weeklyProgressReport.upsert({
      where: { projectId_weekEnding: key },
      create: { ...key, data: data as object, pdfUrl, generatedById: req.user!.id },
      update: { data: data as object, pdfUrl, generatedById: req.user!.id, generatedAt: new Date() },
      include: { generatedBy: { select: { id: true, name: true } } },
    });
    audit(
      req,
      existing ? 'weeklyProgress.revise' : 'weeklyProgress.finalise',
      'WeeklyProgressReport',
      report.id,
      { weekEnding },
    );
    res
      .status(existing ? 200 : 201)
      .json({ ...report, pdfUrl: report.pdfUrl ? signFileUrl(report.pdfUrl) : null });
  }),
);

router.get(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const report = await prisma.weeklyProgressReport.findUnique({ where: { id: req.params.id } });
    if (!report || report.projectId !== req.params.projectId || !report.pdfUrl) {
      throw ApiError.notFound('Report not found');
    }
    res.json({ url: signFileUrl(report.pdfUrl) });
  }),
);

export default router;
