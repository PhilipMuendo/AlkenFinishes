import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { aiAvailable, AiError } from '../services/ai';
import { allowanceMessage, checkAllowance } from '../services/aiUsage';
import { answerQuestion } from '../services/projectChat';

/**
 * Asking the system a question.
 *
 * Open to supervisors as well as the office, because the permission boundary is
 * enforced in the retrieval layer rather than at the door: a supervisor gets
 * answers about their own sites and is refused company money, exactly as they
 * are on the screens. Letting only the office in would have been easier and
 * would also have made the assistant useless to the people on site.
 *
 * Writes nothing, ever. Every route reachable from here is a read.
 */
const router = Router();
router.use(requireAuth);

const askSchema = z.object({
  // Trim first: `.min(2)` runs before `.trim()` in schema order, so a string of
  // spaces would otherwise pass the length check and reach the model empty.
  question: z.string().trim().min(2, 'Ask a question').max(500),
  /** The site the user is looking at, so "this site" resolves. */
  projectId: z.string().optional(),
});

/** Whether to show the assistant at all, and whether it can answer right now. */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    if (!aiAvailable()) {
      res.json({ available: false, canAsk: false, reason: 'NOT_CONFIGURED' });
      return;
    }
    const allowance = await checkAllowance('chat');
    res.json({
      available: true,
      canAsk: allowance.allowed,
      remaining: allowance.remaining,
      ...(allowance.allowed ? {} : { reason: allowance.reason, message: allowanceMessage(allowance) }),
    });
  }),
);

router.post(
  '/ask',
  asyncHandler(async (req, res) => {
    const { question, projectId } = askSchema.parse(req.body);

    if (!aiAvailable()) {
      throw ApiError.badRequest('The assistant is not switched on for this server.');
    }

    // Chat yields to the features the business depends on. Checked before the
    // call rather than after a rejection, so the message can explain WHY there
    // is nothing left — "held back for receipts" is actionable in a way that
    // "quota exceeded" is not.
    const allowance = await checkAllowance('chat');
    if (!allowance.allowed) {
      throw ApiError.badRequest(allowanceMessage(allowance), {
        reason: allowance.reason === 'RESERVED_FOR_WORK' ? 'RESERVED_FOR_WORK' : 'QUOTA_DAILY',
      });
    }

    try {
      const result = await answerQuestion(
        { id: req.user!.id, role: req.user!.role },
        question,
        projectId,
      );
      // The question is logged; the answer is not. What someone asked is worth
      // knowing if the assistant ever misleads them, and it is also the part
      // that stays true if the model changes.
      audit(req, 'chat.ask', 'Chat', 'ask', { question, used: result.used });
      res.json(result);
    } catch (e) {
      if (e instanceof AiError) {
        throw ApiError.badRequest(e.message, {
          reason: e.reason,
          retryAfterSeconds: e.retryAfterSeconds ?? null,
        });
      }
      throw ApiError.badRequest('That question could not be answered just now.');
    }
  }),
);

export default router;
