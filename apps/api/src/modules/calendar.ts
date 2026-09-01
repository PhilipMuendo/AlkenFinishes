import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { derivedEvents } from '../services/calendarFeeds';

/**
 * Company-wide calendar: milestones, inspections, deliveries, meetings.
 * projectId null means a company-wide event, visible on every project's
 * calendar and in the plain list. Mounted at /calendar, not project-scoped —
 * a supervisor needs to see events across their own sites in one place, and
 * an owner needs the whole company's in one place, so scoping is a query
 * param rather than a URL segment.
 */
const router = Router();
router.use(requireAuth);

const EVENT_TYPES = [
  'MILESTONE',
  'INSPECTION',
  'DELIVERY',
  'MEETING',
  'SITE_VISIT',
  'CLIENT_APPOINTMENT',
  'OTHER',
] as const;

/**
 * How far a request with no dates looks. Derived feeds are generated per day
 * over the range, so an unbounded window is not merely slow — it is unbounded.
 */
const DEFAULT_WINDOW_DAYS = 90;
const DAY = 86_400_000;

const eventSchema = z.object({
  projectId: z.string().nullable().optional(),
  title: z.string().min(1),
  type: z.enum(EVENT_TYPES).default('OTHER'),
  date: z.coerce.date(),
  notes: z.string().optional(),
});

const include = {
  project: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { from, to, projectId } = z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        projectId: z.string().optional(),
      })
      .parse(req.query);

    // A supervisor sees events for their own sites plus company-wide ones; a
    // superadmin sees everything, so no project-based restriction applies at
    // all for them — an empty object inside OR still means "match anything",
    // but is easy to misread as a no-op, so it's kept out of the query.
    // Calendar is a site-ops surface an accountant does not get either, so
    // this checks the literal role rather than the finance-aware projectScope().
    const projectFilter =
      projectId != null
        ? { projectId }
        : req.user!.role === 'SUPERADMIN'
          ? {}
          : { OR: [{ project: { supervisorId: req.user!.id } }, { projectId: null }] };

    // Derived events are computed across the window rather than stored, so the
    // window has to be finite even when the caller does not say so.
    const rangeFrom = from ?? new Date();
    const rangeTo = to ?? new Date(rangeFrom.getTime() + DEFAULT_WINDOW_DAYS * DAY);

    const isSuperadmin = req.user!.role === 'SUPERADMIN';
    const [stored, derived] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: {
          ...projectFilter,
          date: { gte: rangeFrom, lte: rangeTo },
        },
        include,
        orderBy: { date: 'asc' },
        take: 500,
      }),
      derivedEvents({
        from: rangeFrom,
        to: rangeTo,
        projectFilter: isSuperadmin ? null : { supervisorId: req.user!.id },
        projectId,
        // Payroll and birthdays are company-wide facts; a supervisor has no
        // use for them and no business seeing the roster's dates of birth.
        includeCompanyWide: isSuperadmin && projectId == null,
      }),
    ]);

    const merged = [
      ...stored.map((e) => ({ ...e, derived: false as const })),
      ...derived,
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    res.json(merged);
  }),
);

router.post(
  '/',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const data = eventSchema.parse(req.body);
    const event = await prisma.calendarEvent.create({
      data: { ...data, createdById: req.user!.id },
      include,
    });
    audit(req, 'calendarEvent.create', 'CalendarEvent', event.id, { title: event.title });
    res.status(201).json(event);
  }),
);

router.delete(
  '/:id',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    // Derived ids carry a "kind:sourceId" shape and have no row behind them.
    // A bare 404 would read as a bug; the real answer is that the way to move
    // a deadline is to move the deadline.
    if (req.params.id.includes(':')) {
      throw ApiError.badRequest(
        'This entry is generated from a project, contract, tool or worker record — change that record instead',
      );
    }
    const event = await prisma.calendarEvent.findUnique({ where: { id: req.params.id } });
    if (!event) throw ApiError.notFound();
    await prisma.calendarEvent.delete({ where: { id: event.id } });
    audit(req, 'calendarEvent.delete', 'CalendarEvent', event.id);
    res.json({ ok: true });
  }),
);

export default router;
