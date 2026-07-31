import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess } from '../middleware/rbac';
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
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED'] as const;

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
} as const;

const serialize = (s: { photoUrl: string | null; resolvedPhotoUrl: string | null; [k: string]: unknown }) => ({
  ...s,
  photoUrl: signFileUrl(s.photoUrl),
  resolvedPhotoUrl: signFileUrl(s.resolvedPhotoUrl),
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

const statusChangeSchema = z.object({ status: z.enum(STATUSES) });

/**
 * IN_PROGRESS / OPEN are plain status moves. RESOLVED requires the fix photo
 * so verification (see /:id/verify) has something to check. VERIFIED is not
 * settable here — it is its own step, because "marked done" and "office has
 * confirmed it" are different facts and collapsing them defeats the point of
 * a verification step at all.
 */
router.post(
  '/:id/status',
  upload.single('resolvedPhoto'),
  asyncHandler(async (req, res) => {
    const { status } = statusChangeSchema.parse(req.body);
    const existing = await prisma.snagItem.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) {
      if (req.file) removeUploadedFile(`/uploads/${req.file.filename}`);
      throw ApiError.notFound();
    }
    if (status === 'VERIFIED') {
      if (req.file) removeUploadedFile(`/uploads/${req.file.filename}`);
      throw ApiError.badRequest('Use /verify to confirm a fix');
    }
    if (status === 'RESOLVED' && !req.file && !existing.resolvedPhotoUrl) {
      throw ApiError.badRequest('Attach a photo of the fix to mark this resolved');
    }
    const snag = await prisma.snagItem.update({
      where: { id: existing.id },
      data: {
        status,
        lastActionById: req.user!.id,
        ...(status === 'RESOLVED' && {
          resolvedAt: new Date(),
          ...(req.file && { resolvedPhotoUrl: fileUrl(req.file.filename) }),
        }),
      },
      include,
    });
    audit(req, 'snag.status', 'SnagItem', snag.id, { from: existing.status, to: status });
    res.json(serialize(snag));
  }),
);

router.post(
  '/:id/verify',
  asyncHandler(async (req, res) => {
    const existing = await prisma.snagItem.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    if (existing.status !== 'RESOLVED') {
      throw ApiError.conflict('Only a resolved item can be verified');
    }
    const snag = await prisma.snagItem.update({
      where: { id: existing.id },
      data: { status: 'VERIFIED', verifiedAt: new Date(), lastActionById: req.user!.id },
      include,
    });
    audit(req, 'snag.verify', 'SnagItem', snag.id);
    res.json(serialize(snag));
  }),
);

/** Verification failed the fix — reopen rather than leave it stuck. */
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
    const existing = await prisma.snagItem.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    removeUploadedFile(existing.photoUrl);
    removeUploadedFile(existing.resolvedPhotoUrl);
    await prisma.snagItem.delete({ where: { id: existing.id } });
    audit(req, 'snag.delete', 'SnagItem', existing.id);
    res.json({ ok: true });
  }),
);

export default router;
