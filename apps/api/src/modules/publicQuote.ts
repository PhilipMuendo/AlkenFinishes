import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { audit } from '../middleware/audit';
import { signFileUrl } from '../middleware/upload';
import { signLimiter } from '../middleware/rateLimit';
import { hashToken, isLinkUsable, looksLikeToken } from '../services/accessLink';
import { applyQuotationDecision } from './quotations';

/**
 * A client accepting or declining a quotation with no login of their own —
 * the same pattern as publicSign.ts, on its own token type
 * (`QuotationDecisionLink`) so a leaked contract-signing link can never be
 * replayed here or vice versa. See publicSign.ts's docblock for the shared
 * ground rules (single-use, generic failure message, rate-limited).
 */
const router = Router();
router.use(signLimiter);

const INVALID_LINK = 'This link is invalid or has expired. Ask us to send a new one.';

async function loadLink(token: string) {
  if (!looksLikeToken(token)) return null;
  const link = await prisma.quotationDecisionLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { quotation: { include: { client: true } } },
  });
  if (!link || !isLinkUsable(link)) return null;
  return link;
}

router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const link = await loadLink(req.params.token);
    if (!link) throw ApiError.notFound(INVALID_LINK);
    const q = link.quotation;

    res.json({
      title: q.title,
      quotationNo: q.quotationNo,
      clientName: q.client.name,
      total: Number(q.total),
      vatRatePct: Number(q.vatRatePct),
      validUntil: q.validUntil,
      pdfUrl: signFileUrl(q.pdfUrl),
    });
  }),
);

const decisionSchema = z.object({
  outcome: z.enum(['ACCEPTED', 'REJECTED']),
  reason: z.string().optional(),
});

router.post(
  '/:token',
  asyncHandler(async (req, res) => {
    const link = await loadLink(req.params.token);
    if (!link) throw ApiError.notFound(INVALID_LINK);

    const { outcome, reason } = decisionSchema.parse(req.body);
    // applyQuotationDecision itself re-checks the quotation is still SENT
    // (not DRAFT, not already decided) — the link being usable only proves
    // the token is good, not that nothing changed since it was issued.
    const quotation = await applyQuotationDecision(link.quotationId, outcome, reason);

    await prisma.quotationDecisionLink.update({
      where: { id: link.id },
      data: { usedAt: new Date() },
    });

    audit(req, 'quotation.clientDecision', 'Quotation', quotation.id, {
      outcome,
      reason,
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    });

    res.json({ ok: true, status: quotation.status });
  }),
);

export default router;
