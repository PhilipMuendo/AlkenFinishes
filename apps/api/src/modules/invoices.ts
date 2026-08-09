import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { removeUploadedFile, signFileUrl } from '../middleware/upload';
import { env } from '../config/env';
import { nextNumber, seriesYear } from '../services/numbering';
import {
  agingBucket,
  companyReceivables,
  daysOverdue,
  getCompanyProfile,
  getInvoicingConfig,
  invoiceBalanceCents,
  isOverdue,
  LIVE_INVOICE_STATUSES,
  PAYMENT_SETTLED_SUM,
  paymentSettledCents,
  projectReceivables,
  recalcDraft,
} from '../services/invoicing';
import { toCents } from '../services/money';
import {
  buildClaim,
  claimPositions,
  ClaimError,
  type ScheduleLine,
} from '../services/claims';
import { renderInvoicePdf, type InvoiceWithLines } from '../services/documents/invoicePdf';

/**
 * Invoicing is superadmin-only, matching payments.ts: contract sums, client
 * billing, VAT position and receivables are financial data a site supervisor
 * must never see. requireSuperadmin is stacked at the router level so no route
 * under this resource is reachable by a SUPERVISOR.
 */
const router = Router({ mergeParams: true });
router.use(requireAuth, requireSuperadmin, requireProjectAccess);

const lineInclude = { lines: { orderBy: { sortOrder: 'asc' as const } } } as const;

const INVOICE_TYPES = [
  'MOBILISATION',
  'PROGRESS_CLAIM',
  'VARIATION',
  'FINAL_ACCOUNT',
  'RETENTION',
] as const;
const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const;

const lineSchema = z.object({
  description: z.string().min(1, 'Every line needs a description'),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unit: z.string().min(1).default('item'),
  unitPrice: z.coerce.number().nonnegative(),
  taxable: z.coerce.boolean().default(true),
});

const invoiceSchema = z.object({
  type: z.enum(INVOICE_TYPES),
  title: z.string().optional(),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date().optional(),
  dueInDays: z.coerce.number().int().min(0).optional(),
  vatRatePct: z.coerce.number().min(0).max(100).optional(),
  retentionRatePct: z.coerce.number().min(0).max(100).optional(),
  vatInclusive: z.coerce.boolean().optional(),
  clientName: z.string().min(1).optional(),
  clientAddress: z.string().optional(),
  clientKraPin: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, 'An invoice needs at least one line'),
});

type PaymentSlice = {
  amount: Prisma.Decimal;
  whtAmount: Prisma.Decimal;
  whtVatAmount: Prisma.Decimal;
  voidedAt: Date | null;
};

/** Shapes an invoice for the wire: signed URLs, plain numbers, computed balance. */
function serialize(inv: InvoiceWithLines & { payments?: PaymentSlice[] }) {
  const paidCents = (inv.payments ?? [])
    .filter((p) => p.voidedAt === null)
    .reduce((s, p) => s + paymentSettledCents(p), 0);
  const balanceCents = invoiceBalanceCents(toCents(inv.netPayable), paidCents);
  return {
    ...inv,
    subtotal: Number(inv.subtotal),
    vatAmount: Number(inv.vatAmount),
    grossTotal: Number(inv.grossTotal),
    retentionAmount: Number(inv.retentionAmount),
    netPayable: Number(inv.netPayable),
    vatRatePct: Number(inv.vatRatePct),
    retentionRatePct: Number(inv.retentionRatePct),
    lines: inv.lines.map((l) => ({
      ...l,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      lineTotal: Number(l.lineTotal),
      // Decimal serialises as a string; a percentage the client has to parse
      // is a percentage that will eventually be compared as one.
      cumulativePct: l.cumulativePct == null ? null : Number(l.cumulativePct),
    })),
    amountPaid: paidCents / 100,
    balance: balanceCents / 100,
    overdue: inv.status !== 'VOID' && isOverdue(inv.dueDate, balanceCents),
    daysOverdue: inv.status !== 'VOID' ? daysOverdue(inv.dueDate, balanceCents) : 0,
    agingBucket: agingBucket(inv.dueDate, balanceCents),
    pdfUrl: signFileUrl(inv.pdfUrl),
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, type, overdue } = z
      .object({
        status: z.enum(INVOICE_STATUSES).optional(),
        type: z.enum(INVOICE_TYPES).optional(),
        overdue: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);

    const invoices = await prisma.invoice.findMany({
      where: { projectId: req.params.projectId, ...(status && { status }), ...(type && { type }) },
      include: { ...lineInclude, payments: { select: { ...PAYMENT_SETTLED_SUM, voidedAt: true } } },
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    const rows = invoices.map(serialize);
    res.json(overdue === 'true' ? rows.filter((r) => r.overdue) : rows);
  }),
);

// Registered before any /:id route so "summary" is never read as an id.
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    res.json(await projectReceivables(req.params.projectId));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = invoiceSchema.parse(req.body);
    const projectId = req.params.projectId;
    const [project, config] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { clientName: true } }),
      getInvoicingConfig(),
    ]);

    const dueDate =
      data.dueDate ??
      new Date(
        data.issueDate.getTime() + (data.dueInDays ?? config.defaultPaymentTermsDays) * 86_400_000,
      );

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          projectId,
          type: data.type,
          title: data.title,
          issueDate: data.issueDate,
          dueDate,
          clientName: data.clientName ?? project.clientName,
          clientAddress: data.clientAddress,
          clientKraPin: data.clientKraPin,
          vatRatePct: data.vatRatePct ?? config.vatRatePct,
          retentionRatePct: data.retentionRatePct ?? config.defaultRetentionPct,
          vatInclusive: data.vatInclusive ?? false,
          notes: data.notes,
          createdById: req.user!.id,
          lines: {
            create: data.lines.map((l, i) => ({
              sortOrder: i,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              unitPrice: l.unitPrice,
              taxable: l.taxable,
              lineTotal: 0, // recalcDraft is the only writer of computed money
            })),
          },
        },
      });
      await recalcDraft(tx, created.id);
      return tx.invoice.findUniqueOrThrow({ where: { id: created.id }, include: lineInclude });
    });

    audit(req, 'invoice.create', 'Invoice', invoice.id, { type: invoice.type });
    res.status(201).json(serialize(invoice));
  }),
);

/**
 * The priced schedule this project is claimed against, with each item's
 * position: what it is worth, what has already been claimed, what is left.
 *
 * The schedule comes from the accepted quotation behind the contract — the
 * same lines the client agreed to — so a claim is measured against the
 * document that was signed rather than against anything retyped since.
 */
async function loadClaimContext(projectId: string) {
  const contract = await prisma.contract.findUnique({
    where: { projectId },
    select: {
      id: true,
      contractNo: true,
      title: true,
      quotation: { select: { id: true, lines: { orderBy: { sortOrder: 'asc' } } } },
    },
  });
  const schedule: ScheduleLine[] = (contract?.quotation?.lines ?? []).map((l) => ({
    id: l.id,
    description: l.description,
    quantity: Number(l.quantity),
    unit: l.unit,
    unitPrice: Number(l.unitPrice),
    lineTotal: Number(l.lineTotal),
    taxable: l.taxable,
    sortOrder: l.sortOrder,
  }));

  // Only invoices that still count. A VOID invoice claimed nothing, and a
  // DRAFT has not been issued to anyone — counting either would permanently
  // suppress value that has not actually been billed.
  const priorLines = await prisma.invoiceLine.findMany({
    where: {
      sourceLineId: { not: null },
      invoice: { projectId, status: { in: LIVE_INVOICE_STATUSES } },
    },
    select: { sourceLineId: true, lineTotal: true },
  });
  const priors = priorLines.map((l) => ({
    sourceLineId: l.sourceLineId!,
    lineTotal: Number(l.lineTotal),
  }));

  return { contract, schedule, priors };
}

router.get(
  '/claim-schedule',
  asyncHandler(async (req, res) => {
    const { contract, schedule, priors } = await loadClaimContext(req.params.projectId);
    const positions = claimPositions(schedule, priors);
    const contractValue = schedule.reduce((s, l) => s + l.lineTotal, 0);
    const claimedToDate = positions.reduce((s, p) => s + p.previouslyClaimed, 0);
    res.json({
      contract: contract
        ? { id: contract.id, contractNo: contract.contractNo, title: contract.title }
        : null,
      // An empty schedule is a real answer, not an error: a project raised
      // without a quotation has nothing to measure a claim against, and the
      // UI needs to say so rather than show a blank table.
      hasSchedule: schedule.length > 0,
      contractValue,
      claimedToDate,
      remainingToClaim: Math.max(0, contractValue - claimedToDate),
      positions,
    });
  }),
);

const claimSchema = z.object({
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date().optional(),
  dueInDays: z.coerce.number().int().min(0).optional(),
  title: z.string().optional(),
  notes: z.string().optional(),
  retentionRatePct: z.coerce.number().min(0).max(100).optional(),
  /** Set only after the user has been shown the credits and accepted them. */
  allowReversals: z.coerce.boolean().default(false),
  items: z
    .array(
      z.object({
        sourceLineId: z.string(),
        cumulativePct: z.coerce.number().min(0).max(100),
      }),
    )
    .min(1, 'Choose at least one item to claim'),
});

/**
 * Raise a progress claim as a DRAFT.
 *
 * Always a draft, never issued directly: a claim is the document most likely
 * to be argued over, and it should be read once by a human before it carries
 * an invoice number.
 */
router.post(
  '/claim',
  asyncHandler(async (req, res) => {
    const data = claimSchema.parse(req.body);
    const projectId = req.params.projectId;
    const { schedule, priors } = await loadClaimContext(projectId);
    if (schedule.length === 0) {
      throw ApiError.badRequest(
        'This project has no priced schedule to claim against — link it to a contract with an accepted quotation first',
      );
    }

    let claim;
    try {
      claim = buildClaim(schedule, priors, data.items);
    } catch (e) {
      if (e instanceof ClaimError) throw ApiError.badRequest(e.message);
      throw e;
    }

    if (claim.lines.length === 0) {
      throw ApiError.badRequest(
        'Nothing to claim — every item is already claimed at the percentage given',
      );
    }
    if (claim.reversals.length > 0 && !data.allowReversals) {
      throw ApiError.conflict(
        `${claim.reversals.length} item(s) are below what has already been claimed, which would raise a credit. Confirm to continue.`,
      );
    }

    const [project, config] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { clientName: true } }),
      getInvoicingConfig(),
    ]);
    const dueDate =
      data.dueDate ??
      new Date(
        data.issueDate.getTime() + (data.dueInDays ?? config.defaultPaymentTermsDays) * 86_400_000,
      );

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          projectId,
          type: 'PROGRESS_CLAIM',
          title: data.title,
          issueDate: data.issueDate,
          dueDate,
          clientName: project.clientName,
          vatRatePct: config.vatRatePct,
          retentionRatePct: data.retentionRatePct ?? config.defaultRetentionPct,
          notes: data.notes,
          createdById: req.user!.id,
          lines: {
            create: claim.lines.map((l, i) => ({
              sortOrder: i,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              unitPrice: l.unitPrice,
              taxable: l.taxable,
              sourceLineId: l.sourceLineId,
              cumulativePct: l.cumulativePct,
              // Authoritative for a claim line — recalcDraft preserves it
              // rather than recomputing a meaningless quantity × unitPrice.
              lineTotal: l.lineTotal,
            })),
          },
        },
      });
      await recalcDraft(tx, created.id);
      return tx.invoice.findUniqueOrThrow({ where: { id: created.id }, include: lineInclude });
    });

    audit(req, 'invoice.claim', 'Invoice', invoice.id, {
      items: claim.lines.length,
      subtotal: claim.subtotal,
      reversals: claim.reversals.length,
    });
    res.status(201).json(serialize(invoice));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const inv = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        ...lineInclude,
        payments: {
          orderBy: { paymentDate: 'desc' },
          include: { submittedBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!inv || inv.projectId !== req.params.projectId) throw ApiError.notFound();
    res.json({
      ...serialize(inv),
      payments: inv.payments.map((p) => ({
        ...p,
        amount: Number(p.amount),
        receiptUrl: signFileUrl(p.receiptUrl),
        receiptPdfUrl: signFileUrl(p.receiptPdfUrl),
      })),
    });
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = invoiceSchema.parse(req.body);
    const existing = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== req.params.projectId) throw ApiError.notFound();
    if (existing.status !== 'DRAFT') {
      throw ApiError.conflict(
        'Only a draft invoice can be edited. Void this one and raise a replacement.',
      );
    }

    const dueDate =
      data.dueDate ?? new Date(data.issueDate.getTime() + (data.dueInDays ?? 30) * 86_400_000);

    const invoice = await prisma.$transaction(async (tx) => {
      // Lines are replaced wholesale — simpler and safer than diffing, and a
      // draft has no external references to its line ids.
      await tx.invoiceLine.deleteMany({ where: { invoiceId: existing.id } });
      await tx.invoice.update({
        where: { id: existing.id },
        data: {
          type: data.type,
          title: data.title,
          issueDate: data.issueDate,
          dueDate,
          ...(data.clientName ? { clientName: data.clientName } : {}),
          clientAddress: data.clientAddress,
          clientKraPin: data.clientKraPin,
          ...(data.vatRatePct !== undefined ? { vatRatePct: data.vatRatePct } : {}),
          ...(data.retentionRatePct !== undefined
            ? { retentionRatePct: data.retentionRatePct }
            : {}),
          ...(data.vatInclusive !== undefined ? { vatInclusive: data.vatInclusive } : {}),
          notes: data.notes,
          lines: {
            create: data.lines.map((l, i) => ({
              sortOrder: i,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              unitPrice: l.unitPrice,
              taxable: l.taxable,
              lineTotal: 0,
            })),
          },
        },
      });
      await recalcDraft(tx, existing.id);
      return tx.invoice.findUniqueOrThrow({ where: { id: existing.id }, include: lineInclude });
    });

    audit(req, 'invoice.update', 'Invoice', invoice.id);
    res.json(serialize(invoice));
  }),
);

/**
 * Issue: allocate the number and freeze the document.
 *
 * The transaction does number allocation and persistence only. The PDF is
 * rendered AFTER commit — holding the NumberSequence row lock across a render
 * would serialise concurrent issues behind a slow operation and push them into
 * Prisma's interactive-transaction timeout. A render failure then leaves a
 * correctly numbered invoice with a null pdfUrl and a working retry, which is a
 * far better failure mode than a burnt number.
 */
router.post(
  '/:id/issue',
  asyncHandler(async (req, res) => {
    const config = await getInvoicingConfig();

    const issued = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUniqueOrThrow({
        where: { id: req.params.id },
        include: lineInclude,
      });
      if (inv.projectId !== req.params.projectId) throw ApiError.notFound();
      if (inv.status !== 'DRAFT') throw ApiError.conflict('This invoice has already been issued');
      if (inv.lines.length === 0) {
        throw ApiError.conflict('Add at least one line before issuing this invoice');
      }

      const invoiceNo = await nextNumber(tx, 'INVOICE', {
        prefix: config.invoicePrefix,
        year: seriesYear(inv.issueDate),
        pad: config.numberPadding,
      });

      return tx.invoice.update({
        where: { id: inv.id },
        data: { invoiceNo, status: 'ISSUED', issuedAt: new Date() },
        include: lineInclude,
      });
    });

    const withPdf = await generateAndAttachPdf(issued, req.user!.id);
    audit(req, 'invoice.issue', 'Invoice', issued.id, {
      invoiceNo: issued.invoiceNo,
      netPayable: Number(issued.netPayable),
    });
    res.json(serialize(withPdf));
  }),
);

router.post(
  '/:id/void',
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().min(3, 'Give a reason') }).parse(req.body);
    const inv = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { payments: { where: { voidedAt: null }, select: { id: true } } },
    });
    if (!inv || inv.projectId !== req.params.projectId) throw ApiError.notFound();
    if (inv.status === 'VOID') throw ApiError.conflict('This invoice is already void');
    if (inv.status === 'DRAFT') {
      throw ApiError.conflict('A draft has no number to preserve — delete it instead');
    }
    if (inv.payments.length > 0) {
      throw ApiError.conflict(
        'This invoice has receipted payments against it. Void those receipts first.',
      );
    }

    const voided = await prisma.invoice.update({
      where: { id: inv.id },
      data: { status: 'VOID', voidedAt: new Date(), voidReason: reason },
      include: lineInclude,
    });
    audit(req, 'invoice.void', 'Invoice', inv.id, { invoiceNo: inv.invoiceNo, reason });
    res.json(serialize(voided));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const inv = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!inv || inv.projectId !== req.params.projectId) throw ApiError.notFound();
    if (inv.status !== 'DRAFT') {
      throw ApiError.conflict(
        'Only a draft can be deleted. Issued invoices carry a number and must be voided.',
      );
    }
    await prisma.invoice.delete({ where: { id: inv.id } });
    audit(req, 'invoice.delete', 'Invoice', inv.id);
    res.json({ ok: true });
  }),
);

/** Returns a signed link, regenerating the PDF if it is missing. */
router.get(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const inv = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: lineInclude,
    });
    if (!inv || inv.projectId !== req.params.projectId) throw ApiError.notFound();
    if (inv.status === 'DRAFT') throw ApiError.conflict('Issue this invoice before downloading it');
    const ready =
      inv.pdfUrl && fileExists(inv.pdfUrl) ? inv : await generateAndAttachPdf(inv, req.user!.id);
    res.json({ url: signFileUrl(ready.pdfUrl) });
  }),
);

/** Force a re-render, e.g. after the letterhead or bank details changed. */
router.post(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const inv = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: lineInclude,
    });
    if (!inv || inv.projectId !== req.params.projectId) throw ApiError.notFound();
    if (inv.status === 'DRAFT') {
      throw ApiError.conflict('Issue this invoice before generating its PDF');
    }
    const regenerated = await generateAndAttachPdf(inv, req.user!.id, { replace: true });
    audit(req, 'invoice.pdf.regenerate', 'Invoice', inv.id);
    res.json({ url: signFileUrl(regenerated.pdfUrl) });
  }),
);

function uploadPath(uploadUrl: string): string {
  return path.join(path.resolve(env.UPLOAD_DIR), path.basename(uploadUrl.split('?')[0]));
}

function fileExists(uploadUrl: string): boolean {
  return fs.existsSync(uploadPath(uploadUrl));
}

/**
 * Renders the invoice PDF, stores the unsigned path, and files it in the
 * project's Documents tab so "store inside project" is satisfied by UI that
 * already exists.
 */
async function generateAndAttachPdf(
  inv: InvoiceWithLines,
  userId: string,
  opts: { replace?: boolean } = {},
): Promise<InvoiceWithLines> {
  const [company, config] = await Promise.all([getCompanyProfile(), getInvoicingConfig()]);
  const pdfUrl = await renderInvoicePdf(inv, company, config);

  if (opts.replace && inv.pdfUrl) {
    removeUploadedFile(inv.pdfUrl);
    await prisma.document.deleteMany({ where: { fileUrl: inv.pdfUrl, systemGenerated: true } });
  }

  const stat = fs.statSync(uploadPath(pdfUrl));
  const [updated] = await prisma.$transaction([
    prisma.invoice.update({
      where: { id: inv.id },
      data: { pdfUrl, pdfGeneratedAt: new Date() },
      include: lineInclude,
    }),
    prisma.document.create({
      data: {
        projectId: inv.projectId,
        type: 'INVOICE',
        name: `Invoice ${inv.invoiceNo ?? inv.id}`,
        fileUrl: pdfUrl,
        mimeType: 'application/pdf',
        sizeBytes: stat.size,
        uploadedById: userId,
        systemGenerated: true,
      },
    }),
  ]);
  return updated;
}

export default router;

// ---- Cross-project receivables register (mounted at /api/v1/invoices) ----

/**
 * The company-wide A/R view. Separate from the project-scoped router above
 * because it answers a different question ("who owes us money, across every
 * site") and so cannot go through requireProjectAccess.
 */
export const companyInvoicesRouter = Router();
companyInvoicesRouter.use(requireAuth, requireSuperadmin);

companyInvoicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, overdue, projectId, from, to } = z
      .object({
        status: z.enum(INVOICE_STATUSES).optional(),
        overdue: z.enum(['true', 'false']).optional(),
        projectId: z.string().optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(req.query);

    const issueDate =
      from || to ? { ...(from && { gte: from }), ...(to && { lte: to }) } : undefined;

    const invoices = await prisma.invoice.findMany({
      where: {
        ...(status ? { status } : { status: { not: 'DRAFT' } }),
        ...(projectId && { projectId }),
        ...(issueDate && { issueDate }),
      },
      include: {
        project: { select: { id: true, name: true } },
        payments: { select: { ...PAYMENT_SETTLED_SUM, voidedAt: true } },
      },
      orderBy: [{ dueDate: 'asc' }],
      take: 500,
    });

    const rows = invoices.map((inv) => {
      const paidCents = inv.payments
        .filter((p) => p.voidedAt === null)
        .reduce((s, p) => s + paymentSettledCents(p), 0);
      const balanceCents = invoiceBalanceCents(toCents(inv.netPayable), paidCents);
      return {
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        type: inv.type,
        status: inv.status,
        title: inv.title,
        project: inv.project,
        clientName: inv.clientName,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        netPayable: Number(inv.netPayable),
        amountPaid: paidCents / 100,
        balance: balanceCents / 100,
        overdue: inv.status !== 'VOID' && isOverdue(inv.dueDate, balanceCents),
        daysOverdue: inv.status !== 'VOID' ? daysOverdue(inv.dueDate, balanceCents) : 0,
        agingBucket: agingBucket(inv.dueDate, balanceCents),
      };
    });

    res.json(overdue === 'true' ? rows.filter((r) => r.overdue) : rows);
  }),
);

companyInvoicesRouter.get(
  '/receivables',
  asyncHandler(async (_req, res) => {
    res.json(await companyReceivables());
  }),
);
