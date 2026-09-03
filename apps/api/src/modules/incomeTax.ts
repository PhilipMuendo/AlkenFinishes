import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireFinanceRole } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { ensureYearRecords, getIncomeTaxConfig } from '../services/incomeTax';

/**
 * Corporation Tax tracking: the four instalment-tax payments and the annual
 * self-assessment return for a tax year.
 *
 * Same reporting-only stance as the rest of Tax: this records what the
 * company estimated and what it paid, on dates it can edit — it never decides
 * what is legally due.
 */
const router = Router();
router.use(requireAuth, requireFinanceRole);

router.get(
  '/:taxYear',
  asyncHandler(async (req, res) => {
    const taxYear = Number(req.params.taxYear);
    if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) {
      throw ApiError.badRequest('Enter a valid tax year');
    }
    const [config, records] = await Promise.all([
      getIncomeTaxConfig(),
      ensureYearRecords(taxYear, req.user!.id),
    ]);
    res.json({ config, ...records });
  }),
);

const instalmentUpdateSchema = z.object({
  estimatedTaxForYear: z.coerce.number().min(0).optional(),
  amountPaid: z.coerce.number().min(0).optional(),
  paidAt: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().optional(),
  itaxAckNo: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

router.put(
  '/instalments/:id',
  asyncHandler(async (req, res) => {
    const data = instalmentUpdateSchema.parse(req.body);
    const existing = await prisma.incomeTaxInstalment.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('Instalment not found');

    const updated = await prisma.incomeTaxInstalment.update({
      where: { id: existing.id },
      data,
    });
    audit(req, 'tax.incomeTaxInstalment', 'IncomeTaxInstalment', updated.id, {
      taxYear: updated.taxYear,
      instalmentNo: updated.instalmentNo,
    });
    res.json(updated);
  }),
);

const returnUpdateSchema = z.object({
  taxableProfitEstimate: z.coerce.number().optional(),
  taxDue: z.coerce.number().min(0).optional(),
  filedAt: z.coerce.date().nullable().optional(),
  paidAt: z.coerce.date().nullable().optional(),
  itaxAckNo: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

router.put(
  '/return/:taxYear',
  asyncHandler(async (req, res) => {
    const taxYear = Number(req.params.taxYear);
    const data = returnUpdateSchema.parse(req.body);
    const existing = await prisma.incomeTaxReturn.findUnique({ where: { taxYear } });
    if (!existing) throw ApiError.notFound('No return found for that tax year. Open it first.');

    const updated = await prisma.incomeTaxReturn.update({
      where: { taxYear },
      data,
    });
    audit(req, 'tax.incomeTaxReturn', 'IncomeTaxReturn', updated.id, { taxYear });
    res.json(updated);
  }),
);

export default router;
