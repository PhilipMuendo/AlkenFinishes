import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, removeUploadedFile, saveDataUrlImage, signFileUrl, upload, verifyUploads } from '../middleware/upload';
import { generateToken, hashToken } from '../services/accessLink';
import { ensureHandoverChecklist, mergedItems, renderHandover, type HandoverChecklistItem } from '../services/handover';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

const MAX_PHOTOS = 10;

async function serialize(h: {
  id: string;
  projectId: string;
  items: unknown;
  photoUrls: string[];
  notes: string | null;
  pdfUrl: string | null;
  clientSignerName: string | null;
  clientSignedAt: Date | null;
  companySignerName: string | null;
  companySignedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const items = await mergedItems(h.projectId, h.items as HandoverChecklistItem[], h.photoUrls.length);
  return {
    id: h.id,
    items,
    manualItems: h.items,
    notes: h.notes,
    photoUrls: h.photoUrls.map((u) => signFileUrl(u)),
    pdfUrl: h.pdfUrl ? signFileUrl(h.pdfUrl) : null,
    complete: items.every((i) => i.checked),
    clientSignerName: h.clientSignerName,
    clientSignedAt: h.clientSignedAt,
    companySignerName: h.companySignerName,
    companySignedAt: h.companySignedAt,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const h = await ensureHandoverChecklist(req.params.projectId, req.user!.id);
    res.json(await serialize(h));
  }),
);

router.put(
  '/',
  upload.array('photos', MAX_PHOTOS),
  asyncHandler(async (req, res) => {
    const existing = await ensureHandoverChecklist(req.params.projectId, req.user!.id);
    if (existing.clientSignedAt) {
      throw ApiError.conflict('The client has already signed this handover — it can no longer be edited.');
    }

    const { items, notes } = z
      .object({
        items: z
          .string()
          .transform((v) => JSON.parse(v) as unknown)
          .pipe(z.array(z.object({ label: z.string(), checked: z.coerce.boolean() })).min(1)),
        notes: z.string().trim().nullable().optional(),
      })
      .parse(req.body);

    await verifyUploads(req.files as Express.Multer.File[]);
    const newPhotoUrls = ((req.files as Express.Multer.File[]) ?? []).map((f) => fileUrl(f.filename));

    const updated = await prisma.handoverChecklist.update({
      where: { id: existing.id },
      data: {
        items: items as object,
        ...(notes !== undefined && { notes }),
        ...(newPhotoUrls.length && { photoUrls: { push: newPhotoUrls } }),
      },
    });
    audit(req, 'handover.update', 'HandoverChecklist', updated.id, {});
    res.json(await serialize(updated));
  }),
);

/**
 * A one-time link the client can open with no login to sign the handover —
 * same mechanics as a contract's signing link. Only makes sense once every
 * checklist item is actually complete; sending it early would suggest the
 * handover is ready when it isn't.
 */
router.post(
  '/signing-link',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const h = await ensureHandoverChecklist(req.params.projectId, req.user!.id);
    if (h.clientSignedAt) throw ApiError.conflict('This handover has already been signed');
    const items = await mergedItems(h.projectId, h.items as unknown as HandoverChecklistItem[], h.photoUrls.length);
    const outstanding = items.filter((i) => !i.checked);
    if (outstanding.length > 0) {
      throw ApiError.conflict(
        `${outstanding.length} checklist item${outstanding.length === 1 ? '' : 's'} still outstanding: ${outstanding
          .map((i) => i.label)
          .join(', ')}`,
      );
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.handoverSigningLink.updateMany({
        where: { handoverId: h.id, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.handoverSigningLink.create({
        data: { handoverId: h.id, tokenHash, createdById: req.user!.id, expiresAt },
      }),
    ]);

    audit(req, 'handover.signingLink.create', 'HandoverChecklist', h.id, {});
    res.status(201).json({ token, expiresAt });
  }),
);

const countersignSchema = z.object({
  signerName: z.string().trim().min(2, 'Enter the name to sign as'),
  signatureMethod: z.enum(['TYPED', 'DRAWN']),
  signatureImage: z.string().optional(),
});

router.post(
  '/countersign',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const h = await prisma.handoverChecklist.findUnique({ where: { projectId: req.params.projectId } });
    if (!h) throw ApiError.notFound();
    if (!h.clientSignedAt) throw ApiError.conflict('The client has to sign before this can be countersigned');
    if (h.companySignerName) throw ApiError.conflict('This handover has already been countersigned');

    const data = countersignSchema.parse(req.body);
    if (data.signatureMethod === 'DRAWN' && !data.signatureImage) {
      throw ApiError.badRequest('Draw your signature before continuing');
    }

    const signedAt = new Date();
    const imageUrl =
      data.signatureMethod === 'DRAWN' && data.signatureImage
        ? await saveDataUrlImage(data.signatureImage)
        : null;

    const updated = await prisma.handoverChecklist.update({
      where: { id: h.id },
      data: {
        companySignerName: data.signerName,
        companySignedAt: signedAt,
        companySignatureImageUrl: imageUrl,
        companySignedById: req.user!.id,
      },
    });

    let pdfUrl: string;
    try {
      pdfUrl = await renderHandover(updated.id);
    } catch (e) {
      if (imageUrl) removeUploadedFile(imageUrl);
      throw e;
    }
    if (updated.pdfUrl) removeUploadedFile(updated.pdfUrl);
    const final = await prisma.handoverChecklist.update({ where: { id: h.id }, data: { pdfUrl } });

    audit(req, 'handover.countersign', 'HandoverChecklist', h.id, { signerName: data.signerName });
    res.json(await serialize(final));
  }),
);

export default router;
