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

// Page size for the merged feed. Hard-capped at 20 sites filing daily +
// weekly reports, the old fixed take(150)+take(150)->slice(200) meant the
// unfiltered "All sites" view silently lost history older than ~1-2 weeks
// with no way to page back further — this cursor lets the client keep
// asking for older pages instead of hitting an invisible wall.
const PAGE_SIZE = 50;

const querySchema = z.object({
  projectId: z.string().optional(),
  type: z.enum(['DAILY', 'WEEKLY']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  // Exclusive: only rows strictly older than this. Set to the last item's
  // `date` from the previous page to fetch the next one.
  cursor: z.coerce.date().optional(),
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
    const { projectId, type, from, to, cursor } = querySchema.parse(req.query);
    const dateFilter: { gte?: Date; lte?: Date; lt?: Date } = {};
    if (from) dateFilter.gte = from;
    if (to) dateFilter.lte = to;
    if (cursor) dateFilter.lt = cursor;
    const hasDateFilter = Object.keys(dateFilter).length > 0;
    const projectInclude = {
      project: { select: { id: true, name: true } },
      submittedBy: { select: { name: true } },
    } as const;

    const [daily, weekly] = await Promise.all([
      type === 'WEEKLY'
        ? []
        : prisma.dailyReport.findMany({
            where: { ...(projectId && { projectId }), ...(hasDateFilter && { date: dateFilter }) },
            include: projectInclude,
            orderBy: { date: 'desc' },
            take: PAGE_SIZE,
          }),
      type === 'DAILY'
        ? []
        : prisma.weeklyReport.findMany({
            where: {
              ...(projectId && { projectId }),
              ...(hasDateFilter && { weekEnding: dateFilter }),
            },
            include: projectInclude,
            orderBy: { weekEnding: 'desc' },
            take: PAGE_SIZE,
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
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    // Either source hitting the page-size cap means it may hold more rows
    // we haven't fetched yet, even if not all of them made this page.
    const hasMore = daily.length === PAGE_SIZE || weekly.length === PAGE_SIZE;
    const items = feed.slice(0, PAGE_SIZE);
    const nextCursor =
      hasMore && items.length > 0 ? items[items.length - 1].date.toISOString() : null;

    res.json({ items, nextCursor });
  }),
);

export default router;
