import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { removeUploadedFile, signFileUrl, upload, verifyUpload } from '../middleware/upload';
import { env } from '../config/env';
import { nextNumber, seriesYear } from '../services/numbering';
import { getCompanyProfile, getInvoicingConfig } from '../services/invoicing';
import {
  contractPosition,
  getPipelineConfig,
  nextVariationRef,
  syncProjectContractValue,
} from '../services/pipeline';
import { renderContractPdf, type ContractForPdf } from '../services/documents/contractPdf';

/**
 * Contracts — the agreement, and the spine of the "enter it once" chain.
 *
 * A contract is normally raised from an accepted quotation, which carries the
 * client, the title and the priced schedule across without retyping. It is then
 * converted into a project, which carries them across again. From that point
 * the project's contract value is derived from this record rather than typed:
 * original sum plus approved variations.
 */
const router = Router();
router.use(requireAuth, requireSuperadmin);

const STATUSES = ['DRAFT', 'ISSUED', 'SIGNED', 'ACTIVE', 'COMPLETED', 'TERMINATED'] as const;

const contractSchema = z.object({
  clientId: z.string().min(1, 'Choose a client'),
  quotationId: z.string().optional(),
  title: z.string().min(1, 'Give this contract a title'),
  originalValue: z.coerce.number().nonnegative(),
  vatRatePct: z.coerce.number().min(0).max(100).optional(),
  retentionPct: z.coerce.number().min(0).max(100).optional(),
  defectsLiabilityMonths: z.coerce.number().int().min(0).max(120).optional(),
  startDate: z.coerce.date(),
  expectedCompletion: z.coerce.date(),
  notes: z.string().optional(),
});

const include = {
  client: true,
  quotation: { include: { lines: { orderBy: { sortOrder: 'asc' as const } } } },
  project: { select: { id: true, code: true, name: true, status: true, progressPct: true } },
  variations: {
    include: { approvedBy: { select: { id: true, name: true } } },
    orderBy: { reference: 'asc' as const },
  },
} as const;

type ContractRow = Prisma.ContractGetPayload<{ include: typeof include }>;

function serialize(c: ContractRow) {
  return {
    ...c,
    originalValue: Number(c.originalValue),
    vatRatePct: Number(c.vatRatePct),
    retentionPct: Number(c.retentionPct),
    quotation: c.quotation
      ? {
          id: c.quotation.id,
          quotationNo: c.quotation.quotationNo,
          title: c.quotation.title,
          issueDate: c.quotation.issueDate,
          total: Number(c.quotation.total),
        }
      : null,
    variations: c.variations.map((v) => ({
      ...v,
      amount: Number(v.amount),
      documentUrl: signFileUrl(v.documentUrl),
    })),
    position: contractPosition(c, c.variations),
    generatedPdfUrl: signFileUrl(c.generatedPdfUrl),
    signedPdfUrl: signFileUrl(c.signedPdfUrl),
    boqUrl: signFileUrl(c.boqUrl),
    specsUrl: signFileUrl(c.specsUrl),
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, clientId, unconverted } = z
      .object({
        status: z.enum(STATUSES).optional(),
        clientId: z.string().optional(),
        unconverted: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);

    const contracts = await prisma.contract.findMany({
      where: {
        ...(status && { status }),
        ...(clientId && { clientId }),
        ...(unconverted === 'true' && { projectId: null }),
      },
      include,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    res.json(contracts.map(serialize));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const c = await prisma.contract.findUnique({ where: { id: req.params.id }, include });
    if (!c) throw ApiError.notFound();
    res.json(serialize(c));
  }),
);

/** Direct award — a job contracted without a quotation behind it. */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = contractSchema.parse(req.body);
    const [client, invoicing] = await Promise.all([
      prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true } }),
      getInvoicingConfig(),
    ]);
    if (!client) throw ApiError.badRequest('That client no longer exists');

    const contract = await prisma.contract.create({
      data: {
        ...data,
        vatRatePct: data.vatRatePct ?? invoicing.vatRatePct,
        retentionPct: data.retentionPct ?? invoicing.defaultRetentionPct,
      },
      include,
    });
    audit(req, 'contract.create', 'Contract', contract.id, { title: contract.title });
    res.status(201).json(serialize(contract));
  }),
);

/**
 * Raise a contract from an accepted quotation.
 *
 * This is the client's "after uploading a quotation the contract should be auto
 * generated" — everything the contract needs is already on the quotation, so
 * nothing is retyped. The contract sum is the quotation's EX-VAT subtotal,
 * because that is how a Contract Sum is stated and what retention is calculated
 * on; the VAT rate comes across so the gross can still be shown.
 */
router.post(
  '/from-quotation/:quotationId',
  asyncHandler(async (req, res) => {
    const overrides = z
      .object({
        startDate: z.coerce.date(),
        expectedCompletion: z.coerce.date(),
        retentionPct: z.coerce.number().min(0).max(100).optional(),
        defectsLiabilityMonths: z.coerce.number().int().min(0).max(120).optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const [quotation, invoicing] = await Promise.all([
      prisma.quotation.findUnique({
        where: { id: req.params.quotationId },
        include: { contract: { select: { id: true } } },
      }),
      getInvoicingConfig(),
    ]);
    if (!quotation) throw ApiError.notFound();
    if (quotation.status !== 'ACCEPTED') {
      throw ApiError.conflict(
        'Record the client’s acceptance before raising a contract from this quotation',
      );
    }
    if (quotation.contract) {
      throw ApiError.conflict('This quotation already has a contract against it');
    }

    const contract = await prisma.contract.create({
      data: {
        clientId: quotation.clientId,
        quotationId: quotation.id,
        title: quotation.title,
        originalValue: quotation.subtotal,
        vatRatePct: quotation.vatRatePct,
        retentionPct: overrides.retentionPct ?? invoicing.defaultRetentionPct,
        defectsLiabilityMonths: overrides.defectsLiabilityMonths ?? 6,
        startDate: overrides.startDate,
        expectedCompletion: overrides.expectedCompletion,
        notes: overrides.notes,
      },
      include,
    });

    audit(req, 'contract.fromQuotation', 'Contract', contract.id, {
      quotationNo: quotation.quotationNo,
      originalValue: Number(contract.originalValue),
    });
    res.status(201).json(serialize(contract));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = contractSchema.partial().omit({ quotationId: true }).parse(req.body);
    const existing = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound();
    // Once signed, the sum and the dates are what both parties agreed to. They
    // move by variation order, not by editing the record underneath them.
    const locked = existing.status !== 'DRAFT' && existing.status !== 'ISSUED';
    if (locked && (data.originalValue !== undefined || data.vatRatePct !== undefined)) {
      throw ApiError.conflict(
        'This contract is signed. Change its value with a variation order instead.',
      );
    }

    const contract = await prisma.$transaction(async (tx) => {
      await tx.contract.update({ where: { id: existing.id }, data });
      await syncProjectContractValue(tx, existing.id);
      return tx.contract.findUniqueOrThrow({ where: { id: existing.id }, include });
    });
    audit(req, 'contract.update', 'Contract', contract.id);
    res.json(serialize(contract));
  }),
);

/** Issue: allocate the number and render the copy that goes for signature. */
router.post(
  '/:id/issue',
  asyncHandler(async (req, res) => {
    const [invoicing, pipeline] = await Promise.all([getInvoicingConfig(), getPipelineConfig()]);

    const issued = await prisma.$transaction(async (tx) => {
      const c = await tx.contract.findUniqueOrThrow({ where: { id: req.params.id } });
      if (c.status !== 'DRAFT') throw ApiError.conflict('This contract has already been issued');

      const contractNo = await nextNumber(tx, 'CONTRACT', {
        prefix: pipeline.contractPrefix,
        year: seriesYear(c.startDate),
        pad: invoicing.numberPadding,
      });
      return tx.contract.update({
        where: { id: c.id },
        data: { contractNo, status: 'ISSUED' },
      });
    });

    // Rendered after commit — see invoices.ts for why the sequence row lock is
    // not held across a render.
    await generateAndAttachPdf(issued.id, req.user!.id);
    const full = await prisma.contract.findUniqueOrThrow({ where: { id: issued.id }, include });
    audit(req, 'contract.issue', 'Contract', issued.id, { contractNo: issued.contractNo });
    res.json(serialize(full));
  }),
);

/** Record execution, optionally attaching the scanned signed copy. */
router.post(
  '/:id/sign',
  upload.single('signedCopy'),
  asyncHandler(async (req, res) => {
    await verifyUpload(req.file);
    const { signedDate } = z.object({ signedDate: z.coerce.date() }).parse(req.body);

    const existing = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      if (req.file) removeUploadedFile(`/uploads/${req.file.filename}`);
      throw ApiError.notFound();
    }
    if (existing.status === 'DRAFT') {
      if (req.file) removeUploadedFile(`/uploads/${req.file.filename}`);
      throw ApiError.conflict('Issue this contract before recording a signature');
    }

    const signedPdfUrl = req.file ? `/uploads/${req.file.filename}` : existing.signedPdfUrl;
    if (req.file && existing.signedPdfUrl) removeUploadedFile(existing.signedPdfUrl);

    const contract = await prisma.contract.update({
      where: { id: existing.id },
      data: { status: 'SIGNED', signedDate, signedPdfUrl },
      include,
    });
    audit(req, 'contract.sign', 'Contract', contract.id, { signedDate });
    res.json(serialize(contract));
  }),
);

/**
 * The two documents that define what was actually agreed, as opposed to what
 * it costs: the priced bill of quantities and the specification.
 *
 * Both are replaceable — a revised BOQ is normal mid-contract — so uploading
 * over an existing one removes the old file rather than orphaning it on disk.
 * Kept off /sign because they arrive at a different time and often separately
 * from each other.
 */
const ATTACHMENT_FIELDS = ['boq', 'specs'] as const;
type AttachmentField = (typeof ATTACHMENT_FIELDS)[number];
const ATTACHMENT_COLUMN: Record<AttachmentField, 'boqUrl' | 'specsUrl'> = {
  boq: 'boqUrl',
  specs: 'specsUrl',
};

router.post(
  '/:id/attachments',
  upload.fields(ATTACHMENT_FIELDS.map((name) => ({ name, maxCount: 1 }))),
  asyncHandler(async (req, res) => {
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
    const incoming = ATTACHMENT_FIELDS.flatMap((field) => {
      const file = files[field]?.[0];
      return file ? [{ field, file }] : [];
    });
    const discard = () => incoming.forEach(({ file }) => removeUploadedFile(`/uploads/${file.filename}`));

    if (incoming.length === 0) throw ApiError.badRequest('Attach a BOQ or a specification');
    for (const { file } of incoming) await verifyUpload(file);

    const existing = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      discard();
      throw ApiError.notFound();
    }

    const data: Prisma.ContractUpdateInput = {};
    const replaced: string[] = [];
    for (const { field, file } of incoming) {
      const column = ATTACHMENT_COLUMN[field];
      if (existing[column]) replaced.push(existing[column]!);
      data[column] = `/uploads/${file.filename}`;
    }

    const contract = await prisma.contract.update({
      where: { id: existing.id },
      data,
      include,
    });
    // Only after the row is committed — a failed update must not leave the
    // contract pointing at a file that has already been deleted.
    replaced.forEach(removeUploadedFile);

    audit(req, 'contract.attachments', 'Contract', contract.id, {
      uploaded: incoming.map((i) => i.field),
    });
    res.json(serialize(contract));
  }),
);

router.delete(
  '/:id/attachments/:field',
  asyncHandler(async (req, res) => {
    const field = z.enum(ATTACHMENT_FIELDS).parse(req.params.field);
    const column = ATTACHMENT_COLUMN[field];
    const existing = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound();
    if (!existing[column]) throw ApiError.notFound();

    const contract = await prisma.contract.update({
      where: { id: existing.id },
      data: { [column]: null },
      include,
    });
    removeUploadedFile(existing[column]);
    audit(req, 'contract.attachments.remove', 'Contract', contract.id, { field });
    res.json(serialize(contract));
  }),
);

const CONTRACT_STATUS_FLOW = z.object({
  status: z.enum(STATUSES),
  practicalCompletionDate: z.coerce.date().optional(),
});

router.post(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const data = CONTRACT_STATUS_FLOW.parse(req.body);
    const existing = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound();
    // Practical completion starts the defects liability clock, so COMPLETED
    // without a date would leave retention with no release date to work from.
    if (data.status === 'COMPLETED' && !data.practicalCompletionDate) {
      throw ApiError.badRequest(
        'Give the practical completion date — it starts the defects liability period',
      );
    }

    const contract = await prisma.contract.update({
      where: { id: existing.id },
      data: {
        status: data.status,
        ...(data.practicalCompletionDate && {
          practicalCompletionDate: data.practicalCompletionDate,
        }),
      },
      include,
    });
    audit(req, 'contract.status', 'Contract', contract.id, {
      from: existing.status,
      to: data.status,
    });
    res.json(serialize(contract));
  }),
);

/**
 * Convert to a project — the point the pre-project pipeline hands over to the
 * site side of the system.
 *
 * The project inherits the client, the title, the dates and the contract value,
 * and gets a code from its own number series. Everything the supervisor's app
 * shows from here on hangs off the project this creates.
 */
router.post(
  '/:id/convert-to-project',
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        name: z.string().min(1).optional(),
        location: z.string().min(1, 'Where is this site?'),
        supervisorId: z.string().nullable().optional(),
      })
      .parse(req.body);

    const [invoicing, pipeline] = await Promise.all([getInvoicingConfig(), getPipelineConfig()]);

    const project = await prisma.$transaction(async (tx) => {
      const c = await tx.contract.findUniqueOrThrow({
        where: { id: req.params.id },
        include: {
          client: { select: { name: true } },
          variations: { select: { amount: true, status: true } },
        },
      });
      if (c.projectId) throw ApiError.conflict('This contract already has a project');
      if (c.status === 'DRAFT') {
        throw ApiError.conflict('Issue this contract before opening a site against it');
      }

      const code = await nextNumber(tx, 'PROJECT', {
        prefix: pipeline.projectPrefix,
        year: seriesYear(c.startDate),
        pad: 4,
      });
      const position = contractPosition(c, c.variations);

      const created = await tx.project.create({
        data: {
          code,
          name: data.name ?? c.title,
          clientId: c.clientId,
          clientName: c.client.name, // snapshot, same rule as everywhere else
          location: data.location,
          contractValue: position.grossValue,
          startDate: c.startDate,
          expectedCompletion: c.expectedCompletion,
          supervisorId: data.supervisorId ?? null,
          status: 'PLANNING',
        },
      });
      await tx.contract.update({
        where: { id: c.id },
        data: { projectId: created.id, status: c.status === 'SIGNED' ? 'ACTIVE' : c.status },
      });
      return created;
    });

    audit(req, 'contract.convertToProject', 'Project', project.id, {
      contractId: req.params.id,
      code: project.code,
    });
    res.status(201).json(project);
  }),
);

/**
 * Sites this contract could be attached to: no contract of their own, and
 * either this client's or not yet tied to any client.
 */
router.get(
  '/:id/attachable-projects',
  asyncHandler(async (req, res) => {
    const c = await prisma.contract.findUnique({
      where: { id: req.params.id },
      select: { clientId: true },
    });
    if (!c) throw ApiError.notFound();

    const projects = await prisma.project.findMany({
      where: {
        contract: null,
        OR: [{ clientId: c.clientId }, { clientId: null }],
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
      },
      select: {
        id: true,
        code: true,
        name: true,
        clientName: true,
        location: true,
        status: true,
        startDate: true,
        contractValue: true,
      },
      orderBy: { startDate: 'desc' },
      take: 100,
    });
    res.json(projects.map((p) => ({ ...p, contractValue: Number(p.contractValue) })));
  }),
);

/**
 * Attach this contract to a site that already exists.
 *
 * The counterpart to convert-to-project, for the jobs that did not start in
 * this system: work already running when the office came on board, and small
 * jobs that only got a contract later. Without it, a project raised directly
 * is permanently outside the commercial chain — no claim schedule, no contract
 * position, no retention — and the only escape is to abandon it and convert
 * the contract into a second, duplicate site.
 *
 * The contract sum becomes the project's, because from here on the contract is
 * the authority on what the job is worth.
 */
router.post(
  '/:id/attach-project',
  asyncHandler(async (req, res) => {
    const { projectId } = z
      .object({ projectId: z.string().min(1, 'Choose a site') })
      .parse(req.body);

    const project = await prisma.$transaction(async (tx) => {
      const c = await tx.contract.findUniqueOrThrow({
        where: { id: req.params.id },
        include: {
          client: { select: { id: true, name: true } },
          variations: { select: { amount: true, status: true } },
        },
      });
      if (c.projectId) throw ApiError.conflict('This contract already has a site against it');
      if (c.status === 'DRAFT') {
        throw ApiError.conflict('Issue this contract before attaching it to a site');
      }

      const p = await tx.project.findUnique({
        where: { id: projectId },
        include: { contract: { select: { id: true, contractNo: true } } },
      });
      if (!p) throw ApiError.notFound('Site not found');
      if (p.contract) {
        throw ApiError.conflict(
          `${p.name} is already under contract ${p.contract.contractNo ?? 'draft'}`,
        );
      }
      // A contract for one client attached to another client's site would
      // quietly misreport who owes the money on both sides.
      if (p.clientId && p.clientId !== c.clientId) {
        throw ApiError.conflict(
          `${p.name} belongs to a different client. Attach this contract to one of ${c.client.name}'s sites.`,
        );
      }

      const position = contractPosition(c, c.variations);
      const updated = await tx.project.update({
        where: { id: p.id },
        data: {
          contractValue: position.grossValue,
          clientId: c.clientId,
          clientName: c.client.name,
        },
      });
      await tx.contract.update({
        where: { id: c.id },
        data: { projectId: p.id, status: c.status === 'SIGNED' ? 'ACTIVE' : c.status },
      });
      return updated;
    });

    audit(req, 'contract.attachProject', 'Project', project.id, { contractId: req.params.id });
    res.json(project);
  }),
);

/**
 * Detach, for when the wrong site was picked.
 *
 * Refused once anything has been billed against the schedule: those invoice
 * lines point at quotation lines that would no longer belong to the project
 * they were raised on, and the claim history would stop reconciling.
 */
router.delete(
  '/:id/attach-project',
  asyncHandler(async (req, res) => {
    const c = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!c) throw ApiError.notFound();
    if (!c.projectId) throw ApiError.conflict('This contract has no site against it');

    const claimed = await prisma.invoiceLine.count({
      where: { sourceLineId: { not: null }, invoice: { projectId: c.projectId } },
    });
    if (claimed > 0) {
      throw ApiError.conflict(
        'Work has already been claimed against this contract on that site. Void those claims first if the link is genuinely wrong.',
      );
    }

    await prisma.contract.update({ where: { id: c.id }, data: { projectId: null } });
    audit(req, 'contract.detachProject', 'Contract', c.id, { projectId: c.projectId });
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const c = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!c) throw ApiError.notFound();
    if (c.status !== 'DRAFT') {
      throw ApiError.conflict(
        'Only a draft can be deleted. An issued contract carries a number and has to stay on file.',
      );
    }
    if (c.projectId) throw ApiError.conflict('This contract has a project against it');

    await prisma.contract.delete({ where: { id: c.id } });
    audit(req, 'contract.delete', 'Contract', c.id);
    res.json({ ok: true });
  }),
);

// ---- Variation orders ----

router.post(
  '/:id/variations',
  upload.single('document'),
  asyncHandler(async (req, res) => {
    await verifyUpload(req.file);
    const data = z
      .object({
        description: z.string().min(1, 'Describe the change'),
        // Negative is legitimate: an omission reduces the contract value.
        amount: z.coerce.number(),
        requestedDate: z.coerce.date(),
      })
      .parse(req.body);

    const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!contract) {
      if (req.file) removeUploadedFile(`/uploads/${req.file.filename}`);
      throw ApiError.notFound();
    }

    const variation = await prisma.$transaction(async (tx) => {
      const reference = await nextVariationRef(tx, contract.id);
      return tx.variation.create({
        data: {
          contractId: contract.id,
          reference,
          description: data.description,
          amount: data.amount,
          requestedDate: data.requestedDate,
          documentUrl: req.file ? `/uploads/${req.file.filename}` : null,
        },
      });
    });

    audit(req, 'variation.create', 'Variation', variation.id, {
      contractId: contract.id,
      reference: variation.reference,
      amount: Number(variation.amount),
    });
    res.status(201).json({
      ...variation,
      amount: Number(variation.amount),
      documentUrl: signFileUrl(variation.documentUrl),
    });
  }),
);

/**
 * Approve or reject a variation.
 *
 * Approval is the only thing that moves the contract value, so it is also the
 * only place Project.contractValue is re-derived — both inside one transaction,
 * because a variation approved without the project's value following it is
 * exactly the drift this module exists to prevent.
 */
router.post(
  '/:id/variations/:variationId/decision',
  asyncHandler(async (req, res) => {
    const { outcome, reason } = z
      .object({ outcome: z.enum(['APPROVED', 'REJECTED']), reason: z.string().optional() })
      .parse(req.body);

    const existing = await prisma.variation.findUnique({ where: { id: req.params.variationId } });
    if (!existing || existing.contractId !== req.params.id) throw ApiError.notFound();
    if (existing.status !== 'PENDING') {
      throw ApiError.conflict(`This variation has already been ${existing.status.toLowerCase()}`);
    }
    if (outcome === 'REJECTED' && !reason?.trim()) {
      throw ApiError.badRequest('Say why this variation was turned down');
    }

    const variation = await prisma.$transaction(async (tx) => {
      const updated = await tx.variation.update({
        where: { id: existing.id },
        data: {
          status: outcome,
          approvedDate: new Date(),
          approvedById: req.user!.id,
          rejectReason: outcome === 'REJECTED' ? reason!.trim() : null,
        },
      });
      await syncProjectContractValue(tx, existing.contractId);
      return updated;
    });

    audit(req, 'variation.decision', 'Variation', variation.id, {
      contractId: existing.contractId,
      reference: variation.reference,
      outcome,
      amount: Number(variation.amount),
    });
    res.json({ ...variation, amount: Number(variation.amount) });
  }),
);

router.delete(
  '/:id/variations/:variationId',
  asyncHandler(async (req, res) => {
    const variation = await prisma.variation.findUnique({ where: { id: req.params.variationId } });
    if (!variation || variation.contractId !== req.params.id) throw ApiError.notFound();
    if (variation.status === 'APPROVED') {
      throw ApiError.conflict(
        'An approved variation is part of the contract value. Raise an omission instead.',
      );
    }

    removeUploadedFile(variation.documentUrl);
    await prisma.variation.delete({ where: { id: variation.id } });
    audit(req, 'variation.delete', 'Variation', variation.id, { reference: variation.reference });
    res.json({ ok: true });
  }),
);

// ---- PDF ----

router.get(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const c = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!c) throw ApiError.notFound();
    if (c.status === 'DRAFT') throw ApiError.conflict('Issue this contract before downloading it');
    const url =
      c.generatedPdfUrl && fileExists(c.generatedPdfUrl)
        ? c.generatedPdfUrl
        : await generateAndAttachPdf(c.id, req.user!.id);
    res.json({ url: signFileUrl(url) });
  }),
);

router.post(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const c = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!c) throw ApiError.notFound();
    if (c.status === 'DRAFT') throw ApiError.conflict('Issue this contract before rendering it');
    const url = await generateAndAttachPdf(c.id, req.user!.id, { replace: true });
    audit(req, 'contract.pdf.regenerate', 'Contract', c.id);
    res.json({ url: signFileUrl(url) });
  }),
);

// ---- helpers ----

function uploadPath(uploadUrl: string): string {
  return path.join(path.resolve(env.UPLOAD_DIR), path.basename(uploadUrl.split('?')[0]));
}

function fileExists(uploadUrl: string): boolean {
  return fs.existsSync(uploadPath(uploadUrl));
}

async function generateAndAttachPdf(
  contractId: string,
  userId: string,
  opts: { replace?: boolean } = {},
): Promise<string> {
  const contract = (await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: {
      client: true,
      quotation: { include: { lines: { orderBy: { sortOrder: 'asc' } } } },
    },
  })) as ContractForPdf;

  const [company, invoicing, pipeline] = await Promise.all([
    getCompanyProfile(),
    getInvoicingConfig(),
    getPipelineConfig(),
  ]);
  const pdfUrl = await renderContractPdf(
    contract,
    company,
    pipeline,
    invoicing.defaultPaymentTermsDays,
    invoicing.footerNote,
  );

  if (opts.replace && contract.generatedPdfUrl) {
    removeUploadedFile(contract.generatedPdfUrl);
    await prisma.document.deleteMany({
      where: { fileUrl: contract.generatedPdfUrl, systemGenerated: true },
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.contract.update({ where: { id: contractId }, data: { generatedPdfUrl: pdfUrl } });
    // Filed into the project's Documents tab once there is a project to file it
    // against — a contract issued before conversion has nowhere to go yet, and
    // is picked up on the next regenerate.
    if (contract.projectId) {
      await tx.document.create({
        data: {
          projectId: contract.projectId,
          type: 'CONTRACT',
          name: `Contract ${contract.contractNo ?? contract.id}`,
          fileUrl: pdfUrl,
          mimeType: 'application/pdf',
          sizeBytes: fs.statSync(uploadPath(pdfUrl)).size,
          uploadedById: userId,
          systemGenerated: true,
        },
      });
    }
  });

  return pdfUrl;
}

export default router;
