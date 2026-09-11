import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { audit } from '../middleware/audit';
import { signFileUrl, saveDataUrlImage, removeUploadedFile } from '../middleware/upload';
import { signLimiter } from '../middleware/rateLimit';
import { hashToken, isLinkUsable, looksLikeToken } from '../services/accessLink';
import { mergedItems, renderHandover, type HandoverChecklistItem } from '../services/handover';

/**
 * The client-facing handover sign-off — same shape as publicSign.ts: a
 * stranger with no login, scoped to exactly the one handover the token
 * names, every failure mode collapsed into the same generic message.
 */
const router = Router();
router.use(signLimiter);

const INVALID_LINK = 'This link is invalid or has expired. Ask us to send a new one.';

async function loadLink(token: string) {
  if (!looksLikeToken(token)) return null;
  const link = await prisma.handoverSigningLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { handover: { include: { project: { select: { name: true, clientName: true } } } } },
  });
  if (!link || !isLinkUsable(link)) return null;
  return link;
}

router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const link = await loadLink(req.params.token);
    if (!link) throw ApiError.notFound(INVALID_LINK);
    const h = link.handover;
    const items = await mergedItems(h.projectId, h.items as unknown as HandoverChecklistItem[], h.photoUrls.length);

    res.json({
      projectName: h.project.name,
      clientName: h.project.clientName,
      items,
      notes: h.notes,
      photoUrls: h.photoUrls.map((u) => signFileUrl(u)),
    });
  }),
);

const signSchema = z.object({
  signerName: z.string().trim().min(2, 'Enter the name you are signing as'),
  signatureMethod: z.enum(['TYPED', 'DRAWN']),
  signatureImage: z.string().optional(),
  consent: z.literal(true, { message: 'Confirm you are authorised to sign before continuing' }),
});

router.post(
  '/:token',
  asyncHandler(async (req, res) => {
    const link = await loadLink(req.params.token);
    if (!link) throw ApiError.notFound(INVALID_LINK);
    const handover = link.handover;
    if (handover.clientSignedAt) {
      throw ApiError.conflict('This handover has already been signed.');
    }

    const data = signSchema.parse(req.body);
    if (data.signatureMethod === 'DRAWN' && !data.signatureImage) {
      throw ApiError.badRequest('Draw your signature before continuing');
    }

    const signedAt = new Date();
    const ip = req.ip ?? 'unknown';
    const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);

    const imageUrl =
      data.signatureMethod === 'DRAWN' && data.signatureImage
        ? await saveDataUrlImage(data.signatureImage)
        : null;

    const updated = await prisma.$transaction(async (tx) => {
      const h = await tx.handoverChecklist.update({
        where: { id: handover.id },
        data: {
          clientSignerName: data.signerName,
          clientSignedAt: signedAt,
          clientSignatureIp: ip,
          clientSignatureUserAgent: userAgent,
          clientSignatureImageUrl: imageUrl,
        },
      });
      await tx.handoverSigningLink.update({ where: { id: link.id }, data: { usedAt: signedAt } });
      return h;
    });

    let pdfUrl: string;
    try {
      pdfUrl = await renderHandover(updated.id);
    } catch (e) {
      if (imageUrl) removeUploadedFile(imageUrl);
      throw e;
    }
    const final = await prisma.handoverChecklist.update({
      where: { id: updated.id },
      data: { pdfUrl },
    });

    audit(req, 'handover.clientSign', 'HandoverChecklist', handover.id, {
      signerName: data.signerName,
      signatureMethod: data.signatureMethod,
      ip,
      userAgent,
    });

    res.json({ ok: true, signedAt: final.clientSignedAt, pdfUrl: signFileUrl(final.pdfUrl) });
  }),
);

export default router;
