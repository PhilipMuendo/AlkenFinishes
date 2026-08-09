import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { getFinanceSettings } from '../services/finance';
import { getCompanyProfile, getInvoicingConfig } from '../services/invoicing';
import { getPurchaseTaxConfig } from '../services/payables';
import { getPayrollConfig } from '../services/payroll';
import { peekNextNumber } from '../services/numbering';
import { getPipelineConfig } from '../services/pipeline';
import { fileUrl, removeUploadedFile, signFileUrl, upload, verifyUpload } from '../middleware/upload';
import { ApiError } from '../utils/http';

const router = Router();
router.use(requireAuth, requireSuperadmin);

router.get(
  '/thresholds',
  asyncHandler(async (_req, res) => {
    res.json((await getFinanceSettings()).thresholds);
  }),
);

router.get(
  '/finance',
  asyncHandler(async (_req, res) => {
    res.json(await getFinanceSettings());
  }),
);

router.put(
  '/labour-source',
  asyncHandler(async (req, res) => {
    const { labourCostSource } = z
      .object({ labourCostSource: z.enum(['ATTENDANCE', 'EXPENSES', 'BOTH']) })
      .parse(req.body);
    await prisma.setting.upsert({
      where: { key: 'labourCostSource' },
      create: { key: 'labourCostSource', value: labourCostSource },
      update: { value: labourCostSource },
    });
    audit(req, 'settings.labourSource', 'Setting', 'labourCostSource', { labourCostSource });
    res.json({ labourCostSource });
  }),
);

router.put(
  '/thresholds',
  asyncHandler(async (req, res) => {
    const value = z
      .object({
        yellowPct: z.coerce.number().min(1).max(200),
        redPct: z.coerce.number().min(1).max(300),
      })
      .refine((v) => v.redPct > v.yellowPct, { message: 'redPct must exceed yellowPct' })
      .parse(req.body);
    await prisma.setting.upsert({
      where: { key: 'budgetThresholds' },
      create: { key: 'budgetThresholds', value },
      update: { value },
    });
    audit(req, 'settings.thresholds', 'Setting', 'budgetThresholds', value);
    res.json(value);
  }),
);

// ---- Company letterhead & invoicing ----
//
// These drive every generated invoice and receipt, so they live in Settings
// rather than env: the owner must be able to correct a KRA PIN or bank detail
// without a redeploy.

const companySchema = z.object({
  name: z.string().min(1),
  addressLines: z.array(z.string()).max(6).default([]),
  phone: z.string().default(''),
  email: z.string().default(''),
  kraPin: z.string().default(''),
  vatRegistered: z.boolean().default(true),
  bank: z
    .object({
      name: z.string().default(''),
      branch: z.string().default(''),
      accountName: z.string().default(''),
      accountNo: z.string().default(''),
      swift: z.string().default(''),
      mpesaPaybill: z.string().default(''),
    })
    .default({}),
});

router.get(
  '/company',
  asyncHandler(async (_req, res) => {
    const profile = await getCompanyProfile();
    res.json({ ...profile, logoUrl: signFileUrl(profile.logoUrl) });
  }),
);

router.put(
  '/company',
  asyncHandler(async (req, res) => {
    const data = companySchema.parse(req.body);
    // The logo is managed by its own upload route; preserve it across edits.
    const current = await getCompanyProfile();
    const value = { ...data, logoUrl: current.logoUrl };
    // Our typed CompanyProfile has no index signature, so it does not satisfy
    // Prisma's InputJsonObject. Cast only at the write boundary.
    const json = value as unknown as Prisma.InputJsonObject;
    await prisma.setting.upsert({
      where: { key: 'companyProfile' },
      create: { key: 'companyProfile', value: json },
      update: { value: json },
    });
    audit(req, 'settings.company', 'Setting', 'companyProfile');
    res.json({ ...value, logoUrl: signFileUrl(value.logoUrl) });
  }),
);

router.post(
  '/company/logo',
  upload.single('logo'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('logo file is required');
    if (!req.file.mimetype.startsWith('image/')) {
      removeUploadedFile(fileUrl(req.file.filename));
      throw ApiError.badRequest('The logo must be an image');
    }
    await verifyUpload(req.file);
    const current = await getCompanyProfile();
    const value = { ...current, logoUrl: fileUrl(req.file.filename) };
    const json = value as unknown as Prisma.InputJsonObject;
    await prisma.setting.upsert({
      where: { key: 'companyProfile' },
      create: { key: 'companyProfile', value: json },
      update: { value: json },
    });
    if (current.logoUrl) removeUploadedFile(current.logoUrl);
    audit(req, 'settings.company.logo', 'Setting', 'companyProfile');
    res.json({ ...value, logoUrl: signFileUrl(value.logoUrl) });
  }),
);

const invoicingSchema = z.object({
  invoicePrefix: z.string().min(1).max(8).regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and dashes only'),
  receiptPrefix: z.string().min(1).max(8).regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and dashes only'),
  numberPadding: z.coerce.number().int().min(3).max(10),
  vatRatePct: z.coerce.number().min(0).max(100),
  defaultRetentionPct: z.coerce.number().min(0).max(100),
  defaultPaymentTermsDays: z.coerce.number().int().min(0).max(365),
  footerNote: z.string().default(''),
  // Optional: continue an existing paper series by setting the next number.
  startNumber: z.coerce.number().int().min(1).optional(),
});

router.get(
  '/invoicing',
  asyncHandler(async (_req, res) => {
    const config = await getInvoicingConfig();
    const year = new Date().getFullYear();
    const [nextInvoiceNo, nextReceiptNo] = await Promise.all([
      peekNextNumber(prisma, 'INVOICE', {
        prefix: config.invoicePrefix,
        year,
        pad: config.numberPadding,
      }),
      peekNextNumber(prisma, 'RECEIPT', {
        prefix: config.receiptPrefix,
        year,
        pad: config.numberPadding,
      }),
    ]);
    res.json({ ...config, nextInvoiceNo, nextReceiptNo });
  }),
);

router.put(
  '/invoicing',
  asyncHandler(async (req, res) => {
    const { startNumber, ...value } = invoicingSchema.parse(req.body);
    await prisma.setting.upsert({
      where: { key: 'invoicing' },
      create: { key: 'invoicing', value },
      update: { value },
    });
    if (startNumber !== undefined) {
      const scope = `INVOICE:${new Date().getFullYear()}`;
      await prisma.numberSequence.upsert({
        where: { scope },
        create: { scope, next: startNumber },
        update: { next: startNumber },
      });
    }
    audit(req, 'settings.invoicing', 'Setting', 'invoicing', { startNumber });
    res.json(value);
  }),
);

// ---- Tax on what we buy ----

/**
 * Rates are configuration, never constants in the code: they change by finance
 * act, they differ by what is bought, and whether this company is an appointed
 * withholding agent is a fact about the company. Withholding stays off until
 * it is switched on deliberately, so nothing is ever deducted from a supplier
 * by default.
 */
const purchaseTaxSchema = z.object({
  vatRatePct: z.coerce.number().min(0).max(100),
  billsIncludeVat: z.coerce.boolean(),
  withholdingAgent: z.coerce.boolean(),
  defaultWhtRatePct: z.coerce.number().min(0).max(100),
  defaultWhtVatRatePct: z.coerce.number().min(0).max(100),
});

const payrollSchema = z.object({
  enabled: z.coerce.boolean(),
  payeBands: z
    .array(z.object({ upTo: z.coerce.number().positive().nullable(), ratePct: z.coerce.number().min(0).max(100) }))
    .min(1, 'Keep at least one tax band'),
  personalReliefPerMonth: z.coerce.number().min(0),
  nssfTiers: z.array(
    z.object({
      upTo: z.coerce.number().positive().nullable(),
      employeePct: z.coerce.number().min(0).max(100),
      employerPct: z.coerce.number().min(0).max(100),
    }),
  ),
  shifRatePct: z.coerce.number().min(0).max(100),
  shifMinimum: z.coerce.number().min(0),
  housingLevyEmployeePct: z.coerce.number().min(0).max(100),
  housingLevyEmployerPct: z.coerce.number().min(0).max(100),
});

router.get(
  '/payroll',
  asyncHandler(async (_req, res) => {
    res.json(await getPayrollConfig());
  }),
);

router.put(
  '/payroll',
  asyncHandler(async (req, res) => {
    const value = payrollSchema.parse(req.body);
    // Bands must ascend, or a slice would be charged twice or skipped.
    const bounds = value.payeBands.map((b) => b.upTo);
    for (let i = 1; i < bounds.length; i += 1) {
      const prev = bounds[i - 1];
      const cur = bounds[i];
      if (prev === null) throw ApiError.badRequest('Only the last band can be open-ended');
      if (cur !== null && cur <= prev) {
        throw ApiError.badRequest('Each tax band must end above the one before it');
      }
    }
    await prisma.setting.upsert({
      where: { key: 'payroll' },
      create: { key: 'payroll', value },
      update: { value },
    });
    audit(req, 'settings.payroll', 'Setting', 'payroll', { enabled: value.enabled });
    res.json(value);
  }),
);

router.get(
  '/purchase-tax',
  asyncHandler(async (_req, res) => {
    res.json(await getPurchaseTaxConfig());
  }),
);

router.put(
  '/purchase-tax',
  asyncHandler(async (req, res) => {
    const value = purchaseTaxSchema.parse(req.body);
    await prisma.setting.upsert({
      where: { key: 'purchaseTax' },
      create: { key: 'purchaseTax', value },
      update: { value },
    });
    audit(req, 'settings.purchaseTax', 'Setting', 'purchaseTax', value);
    res.json(value);
  }),
);

const pipelineSchema = z.object({
  quotationPrefix: z.string().min(1).max(8),
  contractPrefix: z.string().min(1).max(8),
  projectPrefix: z.string().min(1).max(8),
  quotationValidityDays: z.coerce.number().int().min(1).max(365),
  quotationTermsText: z.string().default(''),
  contractTermsText: z.string().default(''),
});

router.get(
  '/pipeline',
  asyncHandler(async (_req, res) => {
    const config = await getPipelineConfig();
    const invoicing = await getInvoicingConfig();
    const year = new Date().getFullYear();
    const [nextQuotationNo, nextContractNo, nextProjectCode] = await Promise.all([
      peekNextNumber(prisma, 'QUOTATION', {
        prefix: config.quotationPrefix,
        year,
        pad: invoicing.numberPadding,
      }),
      peekNextNumber(prisma, 'CONTRACT', {
        prefix: config.contractPrefix,
        year,
        pad: invoicing.numberPadding,
      }),
      peekNextNumber(prisma, 'PROJECT', { prefix: config.projectPrefix, year, pad: 4 }),
    ]);
    res.json({ ...config, nextQuotationNo, nextContractNo, nextProjectCode });
  }),
);

router.put(
  '/pipeline',
  asyncHandler(async (req, res) => {
    const value = pipelineSchema.parse(req.body);
    await prisma.setting.upsert({
      where: { key: 'pipeline' },
      create: { key: 'pipeline', value },
      update: { value },
    });
    audit(req, 'settings.pipeline', 'Setting', 'pipeline');
    res.json(value);
  }),
);

/**
 * What a new quotation should start with. Its own endpoint because the editor
 * needs one call, not three — the VAT rate lives in the invoicing settings and
 * the validity and terms live in the pipeline settings.
 */
router.get(
  '/quotation-defaults',
  asyncHandler(async (_req, res) => {
    const [invoicing, pipeline] = await Promise.all([getInvoicingConfig(), getPipelineConfig()]);
    res.json({
      vatRatePct: invoicing.vatRatePct,
      validityDays: pipeline.quotationValidityDays,
      termsText: pipeline.quotationTermsText,
    });
  }),
);

router.get(
  '/audit-log',
  asyncHandler(async (req, res) => {
    const { page } = z.object({ page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
    const pageSize = 50;
    const items = await prisma.auditLog.findMany({
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    // hasMore is a cheap "did this page fill up" check, not a total count —
    // fine for simple next/prev paging without an extra count() query.
    res.json({ items, page, hasMore: items.length === pageSize });
  }),
);

export default router;
