import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, removeUploadedFile, signFileUrl, upload, verifyUpload } from '../middleware/upload';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

const SEVERITIES = ['NEAR_MISS', 'MINOR', 'SERIOUS'] as const;

const incidentSchema = z.object({
  occurredAt: z.coerce.date(),
  severity: z.enum(SEVERITIES),
  description: z.string().min(1),
  actionTaken: z.string().optional(),
});

const include = { reportedBy: { select: { id: true, name: true } } } as const;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const incidents = await prisma.safetyIncident.findMany({
      where: { projectId: req.params.projectId },
      include,
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
    res.json(incidents.map((i) => ({ ...i, photoUrl: signFileUrl(i.photoUrl) })));
  }),
);

router.post(
  '/',
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    const data = incidentSchema.parse(req.body);
    await verifyUpload(req.file);
    const incident = await prisma.safetyIncident.create({
      data: {
        ...data,
        projectId: req.params.projectId,
        reportedById: req.user!.id,
        photoUrl: req.file ? fileUrl(req.file.filename) : undefined,
      },
      include,
    });
    audit(req, 'safetyIncident.create', 'SafetyIncident', incident.id, { severity: incident.severity });
    res.status(201).json({ ...incident, photoUrl: signFileUrl(incident.photoUrl) });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.safetyIncident.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    removeUploadedFile(existing.photoUrl);
    await prisma.safetyIncident.delete({ where: { id: existing.id } });
    audit(req, 'safetyIncident.delete', 'SafetyIncident', existing.id);
    res.json({ ok: true });
  }),
);

export default router;
