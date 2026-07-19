import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, upload } from '../middleware/upload';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { type } = z
      .object({
        type: z
          .enum(['CONTRACT', 'APPROVAL', 'CUSTOMER', 'RECEIPT', 'COMPLETION', 'PHOTO', 'OTHER'])
          .optional(),
      })
      .parse(req.query);
    res.json(
      await prisma.document.findMany({
        where: { projectId: req.params.projectId, ...(type && { type }) },
        include: { uploadedBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }),
);

router.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('file is required');
    const { type, name } = z
      .object({
        type: z.enum(['CONTRACT', 'APPROVAL', 'CUSTOMER', 'RECEIPT', 'COMPLETION', 'PHOTO', 'OTHER']),
        name: z.string().min(1),
      })
      .parse(req.body);
    const doc = await prisma.document.create({
      data: {
        projectId: req.params.projectId,
        type,
        name,
        fileUrl: fileUrl(req.file.filename),
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        uploadedById: req.user!.id,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
    audit(req, 'document.upload', 'Document', doc.id, { type, name });
    res.status(201).json(doc);
  }),
);

router.delete(
  '/:id',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc || doc.projectId !== req.params.projectId) throw ApiError.notFound();
    await prisma.document.delete({ where: { id: doc.id } });
    audit(req, 'document.delete', 'Document', doc.id);
    res.json({ ok: true });
  }),
);

export default router;
