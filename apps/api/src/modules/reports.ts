import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireSuperadmin } from '../middleware/rbac';
import { signFileUrl } from '../middleware/upload';

// Cross-site reports feed for the super admin: daily and weekly site reports
// from every project in one chronological stream, filterable by site, type,
// and date range. Superadmin-only — supervisors read/submit within their site.
const router = Router();
router.use(requireAuth, requireSuperadmin);

const querySchema = z.object({
  projectId: z.string().optional(),
  type: z.enum(['DAILY', 'WEEKLY']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

interface FeedItem {
  id: string;
  type: 'DAILY' | 'WEEKLY';
  date: Date; // daily.date or weekly.weekEnding
  project: { id: string; name: string };
  submittedBy: { name: string };
  // daily
  workCompleted?: string;
  workersPresent?: number;
  materialsUsed?: string | null;
  challenges?: string | null;
  // weekly
  summary?: string;
  milestones?: string | null;
  issues?: string | null;
  nextWeekPlan?: string | null;
  photoUrls: string[];
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { projectId, type, from, to } = querySchema.parse(req.query);
    const dateFilter = from || to ? { gte: from, lte: to } : undefined;
    const projectInclude = { project: { select: { id: true, name: true } }, submittedBy: { select: { name: true } } } as const;

    const [daily, weekly] = await Promise.all([
      type === 'WEEKLY'
        ? []
        : prisma.dailyReport.findMany({
            where: { ...(projectId && { projectId }), ...(dateFilter && { date: dateFilter }) },
            include: projectInclude,
            orderBy: { date: 'desc' },
            take: 150,
          }),
      type === 'DAILY'
        ? []
        : prisma.weeklyReport.findMany({
            where: { ...(projectId && { projectId }), ...(dateFilter && { weekEnding: dateFilter }) },
            include: projectInclude,
            orderBy: { weekEnding: 'desc' },
            take: 150,
          }),
    ]);

    const feed: FeedItem[] = [
      ...daily.map((r) => ({
        id: r.id,
        type: 'DAILY' as const,
        date: r.date,
        project: r.project,
        submittedBy: r.submittedBy,
        workCompleted: r.workCompleted,
        workersPresent: r.workersPresent,
        materialsUsed: r.materialsUsed,
        challenges: r.challenges,
        photoUrls: r.photoUrls.map((u) => signFileUrl(u)),
      })),
      ...weekly.map((r) => ({
        id: r.id,
        type: 'WEEKLY' as const,
        date: r.weekEnding,
        project: r.project,
        submittedBy: r.submittedBy,
        summary: r.summary,
        milestones: r.milestones,
        issues: r.issues,
        nextWeekPlan: r.nextWeekPlan,
        photoUrls: r.photoUrls.map((u) => signFileUrl(u)),
      })),
    ]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 200);

    res.json(feed);
  }),
);

export default router;
