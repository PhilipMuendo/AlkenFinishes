import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { signLimiter } from '../middleware/rateLimit';
import { hashToken, isLinkUsable, looksLikeToken } from '../services/accessLink';
import { buildSupplierStatement } from './suppliers';

/**
 * A supplier checking their own balance with no login of their own — same
 * pattern as publicSign.ts/publicQuote.ts, on its own token type
 * (`SupplierStatementLink`). Unlike those two, this link is read-only and
 * not single-use: `isLinkUsable` is checked with `usedAt` always `null`,
 * since nothing here ever sets it.
 */
const router = Router();
router.use(signLimiter);

const INVALID_LINK = 'This link is invalid or has expired. Ask us to send a new one.';

router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const token = req.params.token;
    if (!looksLikeToken(token)) throw ApiError.notFound(INVALID_LINK);

    const link = await prisma.supplierStatementLink.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!link || !isLinkUsable({ ...link, usedAt: null })) {
      throw ApiError.notFound(INVALID_LINK);
    }

    const statement = await buildSupplierStatement(link.supplierId);
    if (!statement) throw ApiError.notFound(INVALID_LINK);

    res.json(statement);
  }),
);

export default router;
