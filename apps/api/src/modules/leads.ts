import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { leadPipeline } from '../services/pipeline';

/**
 * Leads — enquiries being chased, before any money has been quoted.
 *
 * Deliberately thin. A lead exists to answer "what is in the pipeline and what
 * is it worth", and to carry a client through to a quotation without retyping
 * them. Everything commercial happens once a quotation is raised against it.
 */
const router = Router();
router.use(requireAuth, requireSuperadmin);

const STAGES = ['NEW', 'CONTACTED', 'SITE_VISIT', 'QUOTED', 'WON', 'LOST'] as const;

const leadSchema = z.object({
  clientId: z.string().min(1, 'Choose a client'),
  title: z.string().min(1, 'Give this enquiry a title'),
  description: z.string().optional(),
  estimatedValue: z.coerce.number().nonnegative().optional(),
  stage: z.enum(STAGES).optional(),
  source: z.string().optional(),
  expectedCloseDate: z.coerce.date().optional(),
  ownerId: z.string().optional(),
});

const include = {
  client: { select: { id: true, name: true, phone: true, email: true } },
  owner: { select: { id: true, name: true } },
  quotations: {
    select: { id: true, quotationNo: true, status: true, total: true },
    orderBy: { createdAt: 'desc' as const },
  },
} as const;

type LeadRow = Awaited<
  ReturnType<typeof prisma.lead.findFirstOrThrow<{ include: typeof include }>>
>;

function serialize(lead: LeadRow) {
  return {
    ...lead,
    estimatedValue: lead.estimatedValue === null ? null : Number(lead.estimatedValue),
    quotations: lead.quotations.map((q) => ({ ...q, total: Number(q.total) })),
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { stage, clientId, open } = z
      .object({
        stage: z.enum(STAGES).optional(),
        clientId: z.string().optional(),
        open: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);

    const leads = await prisma.lead.findMany({
      where: {
        ...(stage && { stage }),
        ...(clientId && { clientId }),
        ...(open === 'true' && { stage: { notIn: ['WON', 'LOST'] } }),
      },
      include,
      // Nulls last: a lead with no target close date should not head the list.
      orderBy: [{ expectedCloseDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 300,
    });
    res.json(leads.map(serialize));
  }),
);

// Before /:id, so "pipeline" is never read as an id.
router.get(
  '/pipeline',
  asyncHandler(async (_req, res) => {
    res.json(await leadPipeline());
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id }, include });
    if (!lead) throw ApiError.notFound();
    res.json(serialize(lead));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = leadSchema.parse(req.body);
    const lead = await prisma.lead.create({
      data: {
        ...data,
        // Unowned leads are how enquiries get dropped, so default the owner to
        // whoever entered it rather than leaving it null.
        ownerId: data.ownerId ?? req.user!.id,
      },
      include,
    });
    audit(req, 'lead.create', 'Lead', lead.id, { title: lead.title });
    res.status(201).json(serialize(lead));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = leadSchema.parse(req.body);
    const existing = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound();

    const lead = await prisma.lead.update({ where: { id: existing.id }, data, include });
    audit(req, 'lead.update', 'Lead', lead.id, { title: lead.title });
    res.json(serialize(lead));
  }),
);

/**
 * Stage moves are their own endpoint rather than a PUT field.
 *
 * Moving a lead is the action the owner actually performs — from a board, or a
 * one-click button — and it carries a rule a general update should not: losing
 * a lead requires a reason, because "why we lose work" is the one thing a
 * pipeline is worth reading back.
 */
router.post(
  '/:id/stage',
  asyncHandler(async (req, res) => {
    const { stage, lostReason } = z
      .object({ stage: z.enum(STAGES), lostReason: z.string().optional() })
      .parse(req.body);

    const existing = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound();
    if (stage === 'LOST' && !lostReason?.trim()) {
      throw ApiError.badRequest('Say why this one was lost');
    }

    const lead = await prisma.lead.update({
      where: { id: existing.id },
      data: {
        stage,
        lostReason: stage === 'LOST' ? lostReason!.trim() : null,
      },
      include,
    });
    audit(req, 'lead.stage', 'Lead', lead.id, { from: existing.stage, to: stage, lostReason });
    res.json(serialize(lead));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { quotations: true } } },
    });
    if (!lead) throw ApiError.notFound();
    if (lead._count.quotations > 0) {
      throw ApiError.conflict(
        'This lead has quotations against it. Mark it lost instead of deleting it.',
      );
    }

    await prisma.lead.delete({ where: { id: lead.id } });
    audit(req, 'lead.delete', 'Lead', lead.id, { title: lead.title });
    res.json({ ok: true });
  }),
);

export default router;
