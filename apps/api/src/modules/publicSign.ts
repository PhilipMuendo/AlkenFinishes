import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { audit } from '../middleware/audit';
import { signFileUrl, saveDataUrlImage, removeUploadedFile } from '../middleware/upload';
import { signLimiter } from '../middleware/rateLimit';
import { hashToken, isLinkUsable, looksLikeToken } from '../services/accessLink';
import { renderClientSignedContractPdf } from './contracts';

/**
 * The one place in this API a stranger with no login can act at all: a
 * client opening the link a superadmin generated (`POST
 * /contracts/:id/signing-link`) to sign a contract themselves. Everything
 * here is scoped to exactly the one contract the token names — never a list,
 * never another client's data — and every failure mode (unknown, expired,
 * revoked, already-used token) returns the same generic message, so the
 * response never tells a guesser which part of their guess was wrong.
 */
const router = Router();
router.use(signLimiter);

const INVALID_LINK = 'This link is invalid or has expired. Ask us to send a new one.';

async function loadLink(token: string) {
  if (!looksLikeToken(token)) return null;
  const link = await prisma.contractSigningLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { contract: { include: { client: true } } },
  });
  if (!link || !isLinkUsable(link)) return null;
  return link;
}

router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const link = await loadLink(req.params.token);
    if (!link) throw ApiError.notFound(INVALID_LINK);
    const c = link.contract;

    res.json({
      title: c.title,
      contractNo: c.contractNo,
      clientName: c.client.name,
      originalValue: Number(c.originalValue),
      vatRatePct: Number(c.vatRatePct),
      startDate: c.startDate,
      expectedCompletion: c.expectedCompletion,
      unsignedPdfUrl: signFileUrl(c.generatedPdfUrl),
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
    const contract = link.contract;
    if (contract.status !== 'ISSUED') {
      throw ApiError.conflict('This contract has already been signed.');
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

    let pdfUrl: string;
    try {
      pdfUrl = await renderClientSignedContractPdf(
        contract.id,
        { name: data.signerName, imageUrl, signedAt, ip },
        link.createdById,
      );
    } catch (e) {
      if (imageUrl) removeUploadedFile(imageUrl);
      throw e;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const c = await tx.contract.update({
        where: { id: contract.id },
        data: {
          status: 'SIGNED',
          signedDate: signedAt,
          signedPdfUrl: pdfUrl,
          clientSignerName: data.signerName,
          clientSignedAt: signedAt,
          clientSignatureIp: ip,
          clientSignatureUserAgent: userAgent,
          clientSignatureImageUrl: imageUrl,
        },
      });
      await tx.contractSigningLink.update({
        where: { id: link.id },
        data: { usedAt: signedAt },
      });
      return c;
    });

    audit(req, 'contract.clientSign', 'Contract', contract.id, {
      signerName: data.signerName,
      signatureMethod: data.signatureMethod,
      ip,
      userAgent,
    });

    res.json({
      ok: true,
      signedAt: updated.signedDate,
      signedPdfUrl: signFileUrl(updated.signedPdfUrl),
    });
  }),
);

export default router;
