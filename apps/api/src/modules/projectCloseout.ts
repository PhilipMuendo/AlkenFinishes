import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import {
  AUTO_CLOSEOUT_ITEMS,
  CloseoutIncompleteError,
  closeProject,
  ensureProjectCloseout,
  MANUAL_CLOSEOUT_ITEMS,
  mergedCloseoutItems,
  type CloseoutItem,
} from '../services/projectCloseout';

/**
 * The final office-level gate on a project. Superadmin-only throughout —
 * this is a decision about whether the business considers the job done,
 * not a site-operations task a supervisor makes.
 */
const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess, requireSuperadmin);

const AUTO_LABEL_SET: ReadonlySet<string> = new Set(AUTO_CLOSEOUT_ITEMS);

async function serialize(c: {
  id: string;
  items: unknown;
  lessonsLearned: string | null;
  closedAt: Date | null;
  closedBy: { id: string; name: string } | null;
  projectId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  const items = await mergedCloseoutItems(c.projectId, c.items as CloseoutItem[]);
  return {
    id: c.id,
    items: items.map((i) => ({ ...i, auto: AUTO_LABEL_SET.has(i.label) })),
    manualItems: c.items,
    lessonsLearned: c.lessonsLearned,
    complete: items.every((i) => i.checked),
    closedAt: c.closedAt,
    closedBy: c.closedBy,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const c = await ensureProjectCloseout(req.params.projectId, req.user!.id);
    const full = await prisma.projectCloseout.findUniqueOrThrow({
      where: { id: c.id },
      include: { closedBy: { select: { id: true, name: true } } },
    });
    res.json(await serialize(full));
  }),
);

router.put(
  '/',
  asyncHandler(async (req, res) => {
    const existing = await ensureProjectCloseout(req.params.projectId, req.user!.id);
    if (existing.closedAt) throw ApiError.conflict('This project is already closed.');

    // The exact eight manual labels, no more, no fewer — mergedCloseoutItems
    // depends on 'Work completed' always being present, and a silently
    // dropped or renamed item would otherwise corrupt this row for good
    // (every later read throws until it's fixed by hand in the database).
    const { items, lessonsLearned } = z
      .object({
        items: z
          .array(z.object({ label: z.enum(MANUAL_CLOSEOUT_ITEMS), checked: z.boolean() }))
          .length(MANUAL_CLOSEOUT_ITEMS.length)
          .refine(
            (v) => new Set(v.map((i) => i.label)).size === MANUAL_CLOSEOUT_ITEMS.length,
            'Each checklist item must appear exactly once',
          ),
        lessonsLearned: z.string().trim().nullable().optional(),
      })
      .parse(req.body);

    const updated = await prisma.projectCloseout.update({
      where: { id: existing.id },
      data: { items: items as object, ...(lessonsLearned !== undefined && { lessonsLearned }) },
      include: { closedBy: { select: { id: true, name: true } } },
    });
    audit(req, 'projectCloseout.update', 'ProjectCloseout', updated.id, {});
    res.json(await serialize(updated));
  }),
);

router.post(
  '/close',
  asyncHandler(async (req, res) => {
    try {
      await closeProject(req.params.projectId, req.user!.id);
    } catch (e) {
      if (e instanceof CloseoutIncompleteError) throw ApiError.conflict(e.message);
      throw e;
    }
    const full = await prisma.projectCloseout.findUniqueOrThrow({
      where: { projectId: req.params.projectId },
      include: { closedBy: { select: { id: true, name: true } } },
    });
    audit(req, 'projectCloseout.close', 'ProjectCloseout', full.id, {});
    res.json(await serialize(full));
  }),
);

export default router;
