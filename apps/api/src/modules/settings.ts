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
import { peekNextNumber } from '../services/numbering';
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
