import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { removeUploadedFile, signFileUrl } from '../middleware/upload';
import { env } from '../config/env';
import { nextNumber, seriesYear } from '../services/numbering';
import { getCompanyProfile, getInvoicingConfig } from '../services/invoicing';
import { getPipelineConfig, recalcQuotation } from '../services/pipeline';
import { renderQuotationPdf, type QuotationWithLines } from '../services/documents/quotationPdf';
import { generateToken, hashToken } from '../services/accessLink';

/**
 * Quotations — the priced offer that becomes a contract.
 *
 * Same document discipline as invoices, for the same reason: once a quotation
 * has gone to a client it is a document, not a live calculation. It gets its
 * number when it is sent, its lines are frozen at that point, and the totals
 * are stored columns that the PDF prints verbatim.
 */
const router = Router();
router.use(requireAuth, requireSuperadmin);

const STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const;

const lineSchema = z.object({
  description: z.string().min(1, 'Every line needs a description'),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unit: z.string().min(1).default('item'),
  unitPrice: z.coerce.number().nonnegative(),
  taxable: z.coerce.boolean().default(true),
});

const quotationSchema = z.object({
  clientId: z.string().min(1, 'Choose a client'),
  leadId: z.string().optional(),
  title: z.string().min(1, 'Give this quotation a title'),
  issueDate: z.coerce.date(),
  validUntil: z.coerce.date().optional(),
  validForDays: z.coerce.number().int().min(1).optional(),
  vatRatePct: z.coerce.number().min(0).max(100).optional(),
  termsText: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, 'A quotation needs at least one line'),
});

const include = {
  lines: { orderBy: { sortOrder: 'asc' as const } },
  client: { select: { id: true, name: true, phone: true, email: true, kraPin: true } },
  lead: { select: { id: true, title: true, stage: true } },
  preparedBy: { select: { id: true, name: true } },
  contract: { select: { id: true, contractNo: true, status: true } },
} as const;

type QuotationRow = QuotationWithLines & {
  client?: unknown;
  lead?: unknown;
  preparedBy?: unknown;
  contract?: unknown;
};

function serialize(q: QuotationRow) {
  return {
    ...q,
    vatRatePct: Number(q.vatRatePct),
    subtotal: Number(q.subtotal),
    vatAmount: Number(q.vatAmount),
    total: Number(q.total),
    lines: q.lines.map((l) => ({
      ...l,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      lineTotal: Number(l.lineTotal),
    })),
    pdfUrl: signFileUrl(q.pdfUrl),
    // A SENT quotation past its date is stale whether or not a nightly job has
    // got round to stamping it EXPIRED, so the flag is derived on read.
    expired: q.status === 'SENT' && q.validUntil < startOfToday(),
  };
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, clientId, leadId } = z
      .object({
        status: z.enum(STATUSES).optional(),
        clientId: z.string().optional(),
        leadId: z.string().optional(),
      })
      .parse(req.query);

    const quotations = await prisma.quotation.findMany({
      where: { ...(status && { status }), ...(clientId && { clientId }), ...(leadId && { leadId }) },
      include,
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });
    res.json(quotations.map(serialize));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const q = await prisma.quotation.findUnique({ where: { id: req.params.id }, include });
    if (!q) throw ApiError.notFound();
    res.json(serialize(q));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = quotationSchema.parse(req.body);
    const [client, invoicing, pipeline] = await Promise.all([
      prisma.client.findUnique({ where: { id: data.clientId }, select: { name: true } }),
      getInvoicingConfig(),
      getPipelineConfig(),
    ]);
    if (!client) throw ApiError.badRequest('That client no longer exists');

    const quotation = await prisma.$transaction(async (tx) => {
      const created = await tx.quotation.create({
        data: {
          clientId: data.clientId,
          leadId: data.leadId,
          title: data.title,
          issueDate: data.issueDate,
          validUntil: validUntilFrom(data, pipeline.quotationValidityDays),
          clientNameSnapshot: client.name,
          vatRatePct: data.vatRatePct ?? invoicing.vatRatePct,
          termsText: data.termsText ?? pipeline.quotationTermsText,
          notes: data.notes,
          preparedById: req.user!.id,
          lines: { create: lineData(data.lines) },
        },
      });
      await recalcQuotation(tx, created.id);
      return tx.quotation.findUniqueOrThrow({ where: { id: created.id }, include });
    });

    audit(req, 'quotation.create', 'Quotation', quotation.id, { title: quotation.title });
    res.status(201).json(serialize(quotation));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = quotationSchema.parse(req.body);
    const existing = await prisma.quotation.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound();
    if (existing.status !== 'DRAFT') {
      throw ApiError.conflict(
        'This quotation has already gone to the client. Copy it into a new one instead.',
      );
    }

    const pipeline = await getPipelineConfig();
    const quotation = await prisma.$transaction(async (tx) => {
      // Replaced wholesale rather than diffed — a draft has no external
      // references to its line ids, so there is nothing to preserve.
      await tx.quotationLine.deleteMany({ where: { quotationId: existing.id } });
      await tx.quotation.update({
        where: { id: existing.id },
        data: {
          clientId: data.clientId,
          leadId: data.leadId,
          title: data.title,
          issueDate: data.issueDate,
          validUntil: validUntilFrom(data, pipeline.quotationValidityDays),
          ...(data.vatRatePct !== undefined ? { vatRatePct: data.vatRatePct } : {}),
          termsText: data.termsText,
          notes: data.notes,
          lines: { create: lineData(data.lines) },
        },
      });
      // The client can be swapped while it is still a draft, so re-snapshot.
      const client = await tx.client.findUniqueOrThrow({
        where: { id: data.clientId },
        select: { name: true },
      });
      await tx.quotation.update({
        where: { id: existing.id },
        data: { clientNameSnapshot: client.name },
      });
      await recalcQuotation(tx, existing.id);
      return tx.quotation.findUniqueOrThrow({ where: { id: existing.id }, include });
    });

    audit(req, 'quotation.update', 'Quotation', quotation.id);
    res.json(serialize(quotation));
  }),
);

/**
 * Send: allocate the number, freeze the document, render the PDF.
 *
 * Numbering happens inside the transaction and rendering after it commits, for
 * the reason set out in invoices.ts — holding the sequence row lock across a
 * render serialises concurrent sends behind a slow operation, and a failed
 * render leaves a correctly numbered quotation with a retryable null pdfUrl
 * rather than a burnt number.
 */
router.post(
  '/:id/send',
  asyncHandler(async (req, res) => {
    const [invoicing, pipeline] = await Promise.all([getInvoicingConfig(), getPipelineConfig()]);

    const sent = await prisma.$transaction(async (tx) => {
      const q = await tx.quotation.findUniqueOrThrow({
        where: { id: req.params.id },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
      if (q.status !== 'DRAFT') throw ApiError.conflict('This quotation has already been sent');
      if (q.lines.length === 0) {
        throw ApiError.conflict('Add at least one line before sending this quotation');
      }

      const quotationNo = await nextNumber(tx, 'QUOTATION', {
        prefix: pipeline.quotationPrefix,
        year: seriesYear(q.issueDate),
        pad: invoicing.numberPadding,
      });

      const updated = await tx.quotation.update({
        where: { id: q.id },
        data: { quotationNo, status: 'SENT', sentAt: new Date() },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
      // Sending a quote moves the lead on; the owner should not have to do it
      // by hand in a second place.
      if (q.leadId) {
        await tx.lead.updateMany({
          where: { id: q.leadId, stage: { in: ['NEW', 'CONTACTED', 'SITE_VISIT'] } },
          data: { stage: 'QUOTED' },
        });
      }
      return updated;
    });

    await generateAndAttachPdf(sent);
    const full = await prisma.quotation.findUniqueOrThrow({ where: { id: sent.id }, include });
    audit(req, 'quotation.send', 'Quotation', sent.id, {
      quotationNo: sent.quotationNo,
      total: Number(sent.total),
    });
    res.json(serialize(full));
  }),
);

router.post(
  '/:id/decision',
  asyncHandler(async (req, res) => {
    const { outcome, reason } = z
      .object({ outcome: z.enum(['ACCEPTED', 'REJECTED']), reason: z.string().optional() })
      .parse(req.body);

    const quotation = await applyQuotationDecision(req.params.id, outcome, reason);
    audit(req, 'quotation.decision', 'Quotation', quotation.id, { outcome, reason });
    res.json(serialize(quotation));
  }),
);

/**
 * A one-time link a client can open with no login of their own to accept or
 * decline the quotation themselves — the same pattern as
 * `POST /contracts/:id/signing-link` (see publicSign.ts / publicQuote.ts).
 * Only makes sense on a SENT quotation: nothing to decide on a draft, and a
 * quotation already decided shouldn't get a new link suggesting otherwise.
 */
router.post(
  '/:id/decision-link',
  asyncHandler(async (req, res) => {
    const quotation = await prisma.quotation.findUnique({ where: { id: req.params.id } });
    if (!quotation) throw ApiError.notFound();
    if (quotation.status !== 'SENT') {
      throw ApiError.conflict(
        quotation.status === 'DRAFT'
          ? 'Send this quotation before sharing a decision link'
          : 'This quotation has already been decided',
      );
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.quotationDecisionLink.updateMany({
        where: { quotationId: quotation.id, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.quotationDecisionLink.create({
        data: { quotationId: quotation.id, tokenHash, createdById: req.user!.id, expiresAt },
      }),
    ]);

    audit(req, 'quotation.decisionLink.create', 'Quotation', quotation.id);
    res.status(201).json({ token, expiresAt });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const q = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      include: { contract: { select: { id: true } } },
    });
    if (!q) throw ApiError.notFound();
    if (q.status !== 'DRAFT') {
      throw ApiError.conflict(
        'Only a draft can be deleted. A sent quotation carries a number and has to stay on file.',
      );
    }
    if (q.contract) throw ApiError.conflict('This quotation already has a contract against it');

    await prisma.quotation.delete({ where: { id: q.id } });
    audit(req, 'quotation.delete', 'Quotation', q.id);
    res.json({ ok: true });
  }),
);

/** Signed link, regenerating the PDF if the file has gone missing. */
router.get(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const q = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!q) throw ApiError.notFound();
    if (q.status === 'DRAFT') throw ApiError.conflict('Send this quotation before downloading it');
    const ready = q.pdfUrl && fileExists(q.pdfUrl) ? q : await generateAndAttachPdf(q);
    res.json({ url: signFileUrl(ready.pdfUrl) });
  }),
);

/** Force a re-render, e.g. after the letterhead or bank details changed. */
router.post(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const q = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!q) throw ApiError.notFound();
    if (q.status === 'DRAFT') throw ApiError.conflict('Send this quotation before rendering it');
    const regenerated = await generateAndAttachPdf(q, { replace: true });
    audit(req, 'quotation.pdf.regenerate', 'Quotation', q.id);
    res.json({ url: signFileUrl(regenerated.pdfUrl) });
  }),
);

// ---- helpers ----

/**
 * Record the client's decision and, if this quotation came off a lead, move
 * it to WON/LOST with it. Shared by the authenticated `/decision` route and
 * the public decision-link route (publicQuote.ts) so the two can never
 * disagree about what accepting or declining actually does.
 */
export async function applyQuotationDecision(
  quotationId: string,
  outcome: 'ACCEPTED' | 'REJECTED',
  reason: string | undefined,
): Promise<QuotationRow> {
  const existing = await prisma.quotation.findUnique({ where: { id: quotationId } });
  if (!existing) throw ApiError.notFound();
  if (existing.status === 'DRAFT') {
    throw ApiError.conflict('Send this quotation before recording the client’s decision');
  }
  if (outcome === 'REJECTED' && !reason?.trim()) {
    throw ApiError.badRequest('Say why the client turned it down');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.quotation.update({
      where: { id: existing.id },
      data: {
        status: outcome,
        decidedAt: new Date(),
        rejectReason: outcome === 'REJECTED' ? reason!.trim() : null,
      },
      include,
    });
    if (updated.leadId) {
      await tx.lead.update({
        where: { id: updated.leadId },
        data:
          outcome === 'ACCEPTED'
            ? { stage: 'WON', lostReason: null }
            : { stage: 'LOST', lostReason: reason!.trim() },
      });
    }
    return updated;
  });
}

function lineData(lines: z.infer<typeof lineSchema>[]) {
  return lines.map((l, i) => ({
    sortOrder: i,
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    unitPrice: l.unitPrice,
    taxable: l.taxable,
    lineTotal: 0, // recalcQuotation is the only writer of computed money
  }));
}

function validUntilFrom(
  data: Pick<z.infer<typeof quotationSchema>, 'validUntil' | 'validForDays' | 'issueDate'>,
  defaultDays: number,
): Date {
  if (data.validUntil) return data.validUntil;
  return new Date(data.issueDate.getTime() + (data.validForDays ?? defaultDays) * 86_400_000);
}

function uploadPath(uploadUrl: string): string {
  return path.join(path.resolve(env.UPLOAD_DIR), path.basename(uploadUrl.split('?')[0]));
}

function fileExists(uploadUrl: string): boolean {
  return fs.existsSync(uploadPath(uploadUrl));
}

async function generateAndAttachPdf(
  q: QuotationWithLines,
  opts: { replace?: boolean } = {},
): Promise<QuotationWithLines> {
  const [company, config] = await Promise.all([getCompanyProfile(), getInvoicingConfig()]);
  const pdfUrl = await renderQuotationPdf(q, company, config);
  if (opts.replace && q.pdfUrl) removeUploadedFile(q.pdfUrl);
  // Not filed into a project's Documents tab, unlike an invoice: at quotation
  // stage there is no project yet to file it against.
  return prisma.quotation.update({
    where: { id: q.id },
    data: { pdfUrl },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  });
}

export default router;
