import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireFinanceRole } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import {
  getVatFiling,
  monthPeriod,
  outstandingCertificates,
  recordVatFiling,
  taxPosition,
} from '../services/taxPosition';

/**
 * The company's tax position, across both sides of the ledger.
 *
 * Superadmin/Accountant-only: this is the whole company's VAT and withholding
 * exposure.
 *
 * Everything here REPORTS what was entered. Nothing decides what is legally
 * due — the rates are the user's own, and a figure is only as good as what was
 * recorded against the bill or receipt it came from.
 */
const router = Router();
router.use(requireAuth, requireFinanceRole);

const periodSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.get(
  '/position',
  asyncHandler(async (req, res) => {
    const { from, to } = periodSchema.parse(req.query);
    // Default to this calendar month, which is the VAT period.
    const period = from && to ? { from, to } : monthPeriod();
    if (period.from > period.to) throw ApiError.badRequest('The period ends before it starts');
    res.json(await taxPosition(period));
  }),
);

/**
 * Withholding certificates a client owes us.
 *
 * Until the certificate is in hand the credit cannot be claimed, so this is
 * money already surrendered to KRA that we cannot yet use. It is a chase list,
 * oldest first.
 */
router.get(
  '/certificates-outstanding',
  asyncHandler(async (_req, res) => {
    res.json(await outstandingCertificates());
  }),
);

/**
 * Whether a VAT period has been filed/paid on iTax.
 *
 * `null` means no filing has been recorded for that period at all — not an
 * error, just "nobody has marked this yet".
 */
router.get(
  '/vat-filing',
  asyncHandler(async (req, res) => {
    const { from, to } = periodSchema.parse(req.query);
    const period = from && to ? { from, to } : monthPeriod();
    if (period.from > period.to) throw ApiError.badRequest('The period ends before it starts');
    res.json(await getVatFiling(period));
  }),
);

/** Record or correct a period's filing/payment status. */
router.post(
  '/vat-filing',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        from: z.coerce.date(),
        to: z.coerce.date(),
        filedAt: z.coerce.date().nullable().optional(),
        paidAt: z.coerce.date().nullable().optional(),
        itaxAckNo: z.string().trim().nullable().optional(),
        notes: z.string().trim().nullable().optional(),
      })
      .parse(req.body);
    if (body.from > body.to) throw ApiError.badRequest('The period ends before it starts');

    const filing = await recordVatFiling(
      { from: body.from, to: body.to },
      { filedAt: body.filedAt, paidAt: body.paidAt, itaxAckNo: body.itaxAckNo, notes: body.notes },
      req.user!.id,
    );
    audit(req, 'tax.vatFiling', 'VatFiling', filing.id, {
      filedAt: filing.filedAt,
      paidAt: filing.paidAt,
    });
    res.json(filing);
  }),
);

/** Record that a client's withholding certificate has arrived. */
router.post(
  '/payments/:id/certificate',
  asyncHandler(async (req, res) => {
    const { whtCertNo, receivedAt } = z
      .object({
        whtCertNo: z.string().trim().min(1, 'Enter the certificate number'),
        receivedAt: z.coerce.date().optional(),
      })
      .parse(req.body);

    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!payment) throw ApiError.notFound('Receipt not found');
    if (Number(payment.whtAmount) + Number(payment.whtVatAmount) <= 0) {
      throw ApiError.badRequest('No tax was withheld on this receipt');
    }

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { whtCertNo, whtCertReceivedAt: receivedAt ?? new Date() },
    });
    audit(req, 'tax.certificateReceived', 'Payment', payment.id, { whtCertNo });
    res.json({
      id: updated.id,
      whtCertNo: updated.whtCertNo,
      whtCertReceivedAt: updated.whtCertReceivedAt,
    });
  }),
);

/**
 * Mark tax withheld from suppliers as remitted to KRA.
 *
 * Recorded per payment rather than as one company-wide flag, because a
 * remittance covers a specific set of deductions and the certificate issued to
 * each supplier has to be traceable back to the payment it came from.
 */
router.post(
  '/supplier-payments/:id/remitted',
  asyncHandler(async (req, res) => {
    const { remittedAt } = z
      .object({ remittedAt: z.coerce.date().optional() })
      .parse(req.body ?? {});

    const payment = await prisma.supplierPayment.findUnique({ where: { id: req.params.id } });
    if (!payment) throw ApiError.notFound('Payment not found');
    if (Number(payment.whtAmount) + Number(payment.whtVatAmount) <= 0) {
      throw ApiError.badRequest('No tax was withheld on this payment');
    }
    if (payment.whtRemittedAt) throw ApiError.conflict('This has already been marked remitted');

    const updated = await prisma.supplierPayment.update({
      where: { id: payment.id },
      data: { whtRemittedAt: remittedAt ?? new Date() },
    });
    audit(req, 'tax.supplierWithholdingRemitted', 'SupplierPayment', payment.id, {
      amount: Number(payment.whtAmount) + Number(payment.whtVatAmount),
    });
    res.json({ id: updated.id, whtRemittedAt: updated.whtRemittedAt });
  }),
);

export default router;
