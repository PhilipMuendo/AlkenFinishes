import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, removeUploadedFile, signFileUrl, upload, verifyUpload } from '../middleware/upload';

/**
 * The defect/snag list. A photo with a pinned location is how a site actually
 * communicates "this corner, this crack" — reported, assigned, fixed with a
 * photo of the fix, then verified by the office without a return visit.
 */
const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'REJECTED'] as const;
// What a supervisor may set directly. VERIFIED and REJECTED are the office's
// verdict on a claimed fix and have their own routes.
const SETTABLE_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const;

const annotationSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .optional();

const snagSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  severity: z.enum(SEVERITIES).default('MEDIUM'),
  dueDate: z.coerce.date().optional(),
  assignedToId: z.string().optional(),
  // multipart fields arrive as strings — coerce the pinned point from JSON.
  annotation: z
    .string()
    .optional()
    .transform((v) => (v ? (JSON.parse(v) as unknown) : undefined))
    .pipe(annotationSchema),
});

const include = {
  reportedBy: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  lastActionBy: { select: { id: true, name: true } },
  attempts: {
    orderBy: { attempt: 'asc' },
    include: {
      submittedBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
    },
  },
} as const;

interface SerialisableAttempt {
  photoUrl: string | null;
  [k: string]: unknown;
}

const serialize = (s: {
  photoUrl: string | null;
  resolvedPhotoUrl: string | null;
  attempts?: SerialisableAttempt[];
  [k: string]: unknown;
}) => ({
  ...s,
  photoUrl: signFileUrl(s.photoUrl),
  resolvedPhotoUrl: signFileUrl(s.resolvedPhotoUrl),
  ...(s.attempts && {
    attempts: s.attempts.map((a) => ({ ...a, photoUrl: signFileUrl(a.photoUrl) })),
  }),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.enum(STATUSES).optional() }).parse(req.query);
    const snags = await prisma.snagItem.findMany({
      where: { projectId: req.params.projectId, ...(status && { status }) },
      include,
      orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    res.json(snags.map(serialize));
  }),
);

router.post(
  '/',
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    const data = snagSchema.parse(req.body);
    await verifyUpload(req.file);
    const snag = await prisma.snagItem.create({
      data: {
        projectId: req.params.projectId,
        title: data.title,
        description: data.description,
        location: data.location,
        severity: data.severity,
        dueDate: data.dueDate,
        assignedToId: data.assignedToId,
        annotation: data.annotation,
        photoUrl: req.file ? fileUrl(req.file.filename) : undefined,
        reportedById: req.user!.id,
      },
      include,
    });
    audit(req, 'snag.create', 'SnagItem', snag.id, { title: snag.title, severity: snag.severity });
    res.status(201).json(serialize(snag));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = snagSchema.partial().parse(req.body);
    const existing = await prisma.snagItem.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    const snag = await prisma.snagItem.update({
      where: { id: existing.id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.location !== undefined && { location: data.location }),
        ...(data.severity !== undefined && { severity: data.severity }),
        ...(data.dueDate !== undefined && { dueDate: data.dueDate }),
        ...(data.assignedToId !== undefined && { assignedToId: data.assignedToId || null }),
      },
      include,
    });
    audit(req, 'snag.update', 'SnagItem', snag.id);
    res.json(serialize(snag));
  }),
);

const statusChangeSchema = z.object({
  status: z.enum(SETTABLE_STATUSES),
  notes: z.string().optional(),
});

/**
 * IN_PROGRESS / OPEN are plain status moves. RESOLVED requires the fix photo
 * so verification (see /:id/verify) has something to check, and opens a new
 * SnagAttempt row — the second time a trade claims the same defect is fixed,
 * the first attempt's photo must still be there to compare against.
 *
 * VERIFIED and REJECTED are not settable here: they are the office's verdict,
 * and collapsing "marked done" into "confirmed done" defeats the point of
 * having a verification step at all.
 */
router.post(
  '/:id/status',
  upload.single('resolvedPhoto'),
  asyncHandler(async (req, res) => {
    const { status, notes } = statusChangeSchema.parse(req.body);
    const existing = await prisma.snagItem.findUnique({
      where: { id: req.params.id },
      include: { attempts: { orderBy: { attempt: 'desc' }, take: 1 } },
    });
    if (!existing || existing.projectId !== req.params.projectId) {
      if (req.file) removeUploadedFile(`/uploads/${req.file.filename}`);
      throw ApiError.notFound();
    }
    if (status === 'RESOLVED' && !req.file && !existing.resolvedPhotoUrl) {
      throw ApiError.badRequest('Attach a photo of the fix to mark this resolved');
    }
    await verifyUpload(req.file);

    if (status !== 'RESOLVED') {
      const snag = await prisma.snagItem.update({
        where: { id: existing.id },
        data: { status, lastActionById: req.user!.id },
        include,
      });
      audit(req, 'snag.status', 'SnagItem', snag.id, { from: existing.status, to: status });
      return res.json(serialize(snag));
    }

    // The attempt row and the status move are one fact: a claimed fix with no
    // recorded attempt would be invisible to the rework count, so they commit
    // together or not at all.
    const photoUrl = req.file ? fileUrl(req.file.filename) : existing.resolvedPhotoUrl;
    const nextAttempt = (existing.attempts[0]?.attempt ?? 0) + 1;
    const snag = await prisma.$transaction(async (tx) => {
      await tx.snagAttempt.create({
        data: {
          snagId: existing.id,
          attempt: nextAttempt,
          photoUrl,
          notes,
          submittedById: req.user!.id,
        },
      });
      return tx.snagItem.update({
        where: { id: existing.id },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedPhotoUrl: photoUrl,
          lastActionById: req.user!.id,
        },
        include,
      });
    });
    audit(req, 'snag.status', 'SnagItem', snag.id, {
      from: existing.status,
      to: 'RESOLVED',
      attempt: nextAttempt,
    });
    res.json(serialize(snag));
  }),
);

/** The office accepts the fix. Stamps the open attempt as accepted. */
router.post(
  '/:id/verify',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const existing = await prisma.snagItem.findUnique({
      where: { id: req.params.id },
      include: { attempts: { where: { accepted: null }, orderBy: { attempt: 'desc' }, take: 1 } },
    });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    if (existing.status !== 'RESOLVED') {
      throw ApiError.conflict('Only a resolved item can be verified');
    }
    const open = existing.attempts[0];
    const snag = await prisma.$transaction(async (tx) => {
      if (open) {
        await tx.snagAttempt.update({
          where: { id: open.id },
          data: { accepted: true, reviewedAt: new Date(), reviewedById: req.user!.id },
        });
      }
      return tx.snagItem.update({
        where: { id: existing.id },
        data: { status: 'VERIFIED', verifiedAt: new Date(), lastActionById: req.user!.id },
        include,
      });
    });
    audit(req, 'snag.verify', 'SnagItem', snag.id, { attempt: open?.attempt ?? null });
    res.json(serialize(snag));
  }),
);

/**
 * The repeat job. The office looked at the evidence and the fix is not good
 * enough, so the item goes back to the trade as REJECTED — deliberately not
 * OPEN, because an item that has already failed an inspection is a different
 * risk from one nobody has touched, and reworkCount is what makes a trade that
 * keeps re-doing the same defect visible.
 */
router.post(
  '/:id/reject',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
    const existing = await prisma.snagItem.findUnique({
      where: { id: req.params.id },
      include: { attempts: { where: { accepted: null }, orderBy: { attempt: 'desc' }, take: 1 } },
    });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    if (existing.status !== 'RESOLVED') {
      throw ApiError.conflict('Only a resolved item can be sent back');
    }
    const open = existing.attempts[0];
    const snag = await prisma.$transaction(async (tx) => {
      if (open) {
        await tx.snagAttempt.update({
          where: { id: open.id },
          data: {
            accepted: false,
            rejectReason: reason,
            reviewedAt: new Date(),
            reviewedById: req.user!.id,
          },
        });
      }
      return tx.snagItem.update({
        where: { id: existing.id },
        data: {
          status: 'REJECTED',
          // The attempt keeps its own photo; clearing these puts the item back
          // in the state where the next fix must supply fresh evidence.
          resolvedAt: null,
          resolvedPhotoUrl: null,
          rejectedAt: new Date(),
          rejectReason: reason,
          reworkCount: { increment: 1 },
          lastActionById: req.user!.id,
        },
        include,
      });
    });
    audit(req, 'snag.reject', 'SnagItem', snag.id, { reason, reworkCount: snag.reworkCount });
    res.json(serialize(snag));
  }),
);

/** Reopen a closed item — a defect that came back after it was signed off. */
router.post(
  '/:id/reopen',
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);
    const existing = await prisma.snagItem.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    const snag = await prisma.snagItem.update({
      where: { id: existing.id },
      data: {
        status: 'OPEN',
        resolvedAt: null,
        verifiedAt: null,
        lastActionById: req.user!.id,
        description: reason ? `${existing.description ?? ''}\n\nReopened: ${reason}`.trim() : existing.description,
      },
      include,
    });
    audit(req, 'snag.reopen', 'SnagItem', snag.id, { reason });
    res.json(serialize(snag));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.snagItem.findUnique({
      where: { id: req.params.id },
      include: { attempts: { select: { photoUrl: true } } },
    });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    // The office can clear any entry; the person who raised it can retract
    // their own — same rule as a safety record. VERIFIED is the office's own
    // sign-off, already accepted, so deleting it here would erase a decision
    // rather than a mistake; reopen it first if it turns out not to be fixed.
    if (req.user!.role !== 'SUPERADMIN' && existing.reportedById !== req.user!.id) {
      throw ApiError.forbidden();
    }
    if (existing.status === 'VERIFIED') {
      throw ApiError.conflict('This defect has already been signed off. Reopen it first if it needs deleting.');
    }
    removeUploadedFile(existing.photoUrl);
    removeUploadedFile(existing.resolvedPhotoUrl);
    // Attempt rows cascade, but their photos are files on disk and would be
    // orphaned by the cascade.
    for (const a of existing.attempts) removeUploadedFile(a.photoUrl);
    await prisma.snagItem.delete({ where: { id: existing.id } });
    audit(req, 'snag.delete', 'SnagItem', existing.id);
    res.json({ ok: true });
  }),
);

export default router;
