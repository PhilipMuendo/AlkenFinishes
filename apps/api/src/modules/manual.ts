import { Router } from 'express';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { hasFinanceAccess } from '../middleware/rbac';
import { signFileUrl } from '../middleware/upload';
import { getCompanyProfile } from '../services/invoicing';
import { MANUAL_TOPICS } from '../services/appManual';
import { renderHandbookPdf } from '../services/documents/handbookPdf';

/**
 * The "how do I…" manual, as a downloadable PDF — the same MANUAL_TOPICS
 * content the assistant already answers from (see chatRetrieval.ts), laid
 * out as a document rather than surfaced one question at a time.
 */
const router = Router();
router.use(requireAuth);

/**
 * Same scope rule `lookupsFor()` (chatRetrieval.ts) already applies to
 * these topics as chat lookups — kept as its own small filter here rather
 * than importing that function, since it operates on `Lookup[]`, not
 * `ManualTopic[]`, and pulling in chatRetrieval.ts's much larger module
 * graph for one three-line rule isn't worth it.
 */
function topicsFor(role: string) {
  return MANUAL_TOPICS.filter((t) => {
    if (t.scope === 'office') return role === 'SUPERADMIN';
    if (t.scope === 'finance') return hasFinanceAccess(role);
    return true;
  });
}

router.get(
  '/pdf',
  asyncHandler(async (req, res) => {
    const company = await getCompanyProfile();
    const pdfUrl = await renderHandbookPdf(company, topicsFor(req.user!.role));
    res.json({ url: signFileUrl(pdfUrl) });
  }),
);

export default router;
