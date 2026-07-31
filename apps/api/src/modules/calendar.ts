import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { projectScope, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';

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

const EVENT_TYPES = ['MILESTONE', 'INSPECTION', 'DELIVERY', 'MEETING', 'OTHER'] as const;

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
    const projectFilter =
      projectId != null
        ? { projectId }
        : req.user!.role === 'SUPERADMIN'
          ? {}
          : { OR: [{ project: projectScope(req.user!) }, { projectId: null }] };

    const events = await prisma.calendarEvent.findMany({
      where: {
        ...projectFilter,
        date: {
          ...(from && { gte: from }),
          ...(to && { lte: to }),
        },
      },
      include,
      orderBy: { date: 'asc' },
      take: 500,
    });
    res.json(events);
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
    const event = await prisma.calendarEvent.findUnique({ where: { id: req.params.id } });
    if (!event) throw ApiError.notFound();
    await prisma.calendarEvent.delete({ where: { id: event.id } });
    audit(req, 'calendarEvent.delete', 'CalendarEvent', event.id);
    res.json({ ok: true });
  }),
);

export default router;
