import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

/**
 * Audience is computed here, not stored on the row (see the Notification
 * model comment in schema.prisma):
 * - SUPERADMIN sees everything.
 * - SUPERVISOR sees only SYNC_ISSUE notifications on a site they supervise —
 *   never a budget/payment/invoice/contract one, the same boundary
 *   payVisibility.ts already draws around cost figures. A sync issue carries
 *   no money, just "which fingerprint is unrecognised", so it's safe and
 *   useful for the supervisor to see it for their own site.
 */
function audienceWhere(user: { id: string; role: string }) {
  if (user.role === 'SUPERADMIN') return {};
  return {
    type: 'SYNC_ISSUE' as const,
    projectId: { not: null },
    project: { supervisorId: user.id },
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { includeResolved } = z
      .object({ includeResolved: z.enum(['true', 'false']).optional() })
      .parse(req.query);
    const notifications = await prisma.notification.findMany({
      where: {
        ...audienceWhere(req.user!),
        ...(includeResolved === 'true' ? {} : { resolvedAt: null }),
      },
      include: {
        project: { select: { id: true, name: true } },
        reads: { where: { userId: req.user!.id }, select: { readAt: true } },
      },
      orderBy: { lastSeenAt: 'desc' },
      take: 100,
    });
    res.json(
      notifications.map(({ reads, ...n }) => ({ ...n, readAt: reads[0]?.readAt ?? null })),
    );
  }),
);

router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const count = await prisma.notification.count({
      where: {
        ...audienceWhere(req.user!),
        resolvedAt: null,
        reads: { none: { userId: req.user!.id } },
      },
    });
    res.json({ count });
  }),
);

router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    // upsert, not create: re-reading an already-read notification (e.g. a
    // second click) must not throw on the unique (notificationId, userId).
    await prisma.notificationRead.upsert({
      where: { notificationId_userId: { notificationId: req.params.id, userId: req.user!.id } },
      create: { notificationId: req.params.id, userId: req.user!.id },
      update: {},
    });
    res.json({ ok: true });
  }),
);

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const unread = await prisma.notification.findMany({
      where: {
        ...audienceWhere(req.user!),
        resolvedAt: null,
        reads: { none: { userId: req.user!.id } },
      },
      select: { id: true },
    });
    await prisma.notificationRead.createMany({
      data: unread.map((n) => ({ notificationId: n.id, userId: req.user!.id })),
      skipDuplicates: true,
    });
    res.json({ ok: true, marked: unread.length });
  }),
);

export default router;
