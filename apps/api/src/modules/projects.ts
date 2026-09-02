import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import {
  projectScope,
  requireFinanceProjectAccess,
  requireProjectAccess,
  requireSuperadmin,
} from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { projectFinancials } from '../services/finance';
import { removeUploadedFile } from '../middleware/upload';

const router = Router();
router.use(requireAuth);

const projectSchema = z.object({
  name: z.string().min(1),
  // Either is accepted: a real client from the register (preferred — see the
  // handler below, which snapshots its name the same way
  // contracts.ts's convert-to-project already does), or a plain typed name
  // for a job with no Client record yet. clientName stays required so an
  // existing caller sending only that keeps working unchanged.
  clientId: z.string().optional(),
  clientName: z.string().min(1),
  location: z.string().min(1),
  contractValue: z.coerce.number().nonnegative(),
  startDate: z.coerce.date(),
  expectedCompletion: z.coerce.date(),
  supervisorId: z.string().nullable().optional(),
  status: z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).optional(),
  // Fraud-proofing for manual attendance overrides — see
  // AttendanceOverrideRequest. Optional: fingerprint terminals need none.
  geofenceLat: z.coerce.number().min(-90).max(90).nullable().optional(),
  geofenceLng: z.coerce.number().min(-180).max(180).nullable().optional(),
  geofenceRadiusM: z.coerce.number().int().positive().nullable().optional(),
});

const include = {
  supervisor: { select: { id: true, name: true, email: true, phone: true } },
  // So a project can be traced back to the agreement it came from — the last
  // link in the "enter it once" chain, read in the other direction.
  contract: { select: { id: true, contractNo: true, status: true } },
} as const;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const projects = await prisma.project.findMany({
      where: projectScope(req.user!),
      include,
      orderBy: { createdAt: 'desc' },
    });
    res.json(projects);
  }),
);

router.post(
  '/',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const { clientId, ...data } = projectSchema.parse(req.body);
    // clientName is always the server's own snapshot when a real client was
    // chosen — never trust the client-typed name to agree with the record it
    // claims to be, the same rule convert-to-project already follows.
    const clientName = clientId
      ? (await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true } }))
          .name
      : data.clientName;
    const project = await prisma.project.create({
      data: { ...data, clientId, clientName },
      include,
    });
    audit(req, 'project.create', 'Project', project.id, { name: project.name });
    res.status(201).json(project);
  }),
);

router.get(
  '/:projectId',
  requireFinanceProjectAccess,
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: req.params.projectId },
      include,
    });
    res.json(project);
  }),
);

router.patch(
  '/:projectId',
  requireSuperadmin,
  requireProjectAccess,
  asyncHandler(async (req, res) => {
    const data = projectSchema.partial().parse(req.body);
    const project = await prisma.project.update({
      where: { id: req.params.projectId },
      data,
      include,
    });
    audit(req, 'project.update', 'Project', project.id);
    res.json(project);
  }),
);

router.delete(
  '/:projectId',
  requireSuperadmin,
  requireProjectAccess,
  asyncHandler(async (req, res) => {
    const fileUrls = await collectProjectFileUrls(req.params.projectId);
    // The DB cascade (Postgres FK ON DELETE CASCADE) removes every child row
    // atomically. It has no idea any of those rows pointed at a file on disk,
    // so every photo, receipt and PDF the project ever had would otherwise
    // sit in uploads/ forever with nothing left in the database to name it.
    await prisma.project.delete({ where: { id: req.params.projectId } });
    for (const url of fileUrls) removeUploadedFile(url);
    audit(req, 'project.delete', 'Project', req.params.projectId, { filesRemoved: fileUrls.length });
    res.json({ ok: true });
  }),
);

/**
 * Every file URL that will be orphaned when this project's row cascades away
 * — collected BEFORE the delete, since the rows naming them won't exist
 * afterward. Covers every model with `onDelete: Cascade` back to Project (or
 * to a child that itself cascades from Project) that also stores a file.
 * Models linked with `onDelete: SetNull` (Contract, ToolTransfer.fromProject)
 * survive the delete and keep their files, so they're deliberately excluded.
 */
async function collectProjectFileUrls(projectId: string): Promise<string[]> {
  const [expenses, payments, invoices, taskPhotos, documents, dailyReports, weeklyReports, snags, incidents, toolTransfers] =
    await Promise.all([
      prisma.expense.findMany({ where: { projectId }, select: { receiptUrl: true } }),
      prisma.payment.findMany({ where: { projectId }, select: { receiptUrl: true, receiptPdfUrl: true } }),
      prisma.invoice.findMany({ where: { projectId }, select: { pdfUrl: true } }),
      prisma.taskPhoto.findMany({ where: { task: { projectId } }, select: { fileUrl: true } }),
      prisma.document.findMany({ where: { projectId }, select: { fileUrl: true } }),
      prisma.dailyReport.findMany({ where: { projectId }, select: { photoUrls: true } }),
      prisma.weeklyReport.findMany({ where: { projectId }, select: { photoUrls: true } }),
      prisma.snagItem.findMany({ where: { projectId }, select: { photoUrl: true, resolvedPhotoUrl: true } }),
      prisma.safetyIncident.findMany({ where: { projectId }, select: { photoUrl: true } }),
      prisma.toolTransfer.findMany({ where: { toProjectId: projectId }, select: { proofPhotoUrl: true } }),
    ]);

  return [
    ...expenses.map((r) => r.receiptUrl),
    ...payments.flatMap((r) => [r.receiptUrl, r.receiptPdfUrl]),
    ...invoices.map((r) => r.pdfUrl),
    ...taskPhotos.map((r) => r.fileUrl),
    ...documents.map((r) => r.fileUrl),
    ...dailyReports.flatMap((r) => r.photoUrls),
    ...weeklyReports.flatMap((r) => r.photoUrls),
    ...snags.flatMap((r) => [r.photoUrl, r.resolvedPhotoUrl]),
    ...incidents.map((r) => r.photoUrl),
    ...toolTransfers.map((r) => r.proofPhotoUrl),
  ].filter((url): url is string => !!url);
}

// ---- Budget ----

const budgetSchema = z.object({
  lines: z.array(
    z.object({
      category: z.enum(['MATERIALS', 'LABOUR', 'TRANSPORT', 'OTHER']),
      allocated: z.coerce.number().nonnegative(),
    }),
  ),
});

router.get(
  '/:projectId/budget',
  requireProjectAccess,
  asyncHandler(async (req, res) => {
    res.json(await prisma.budgetLine.findMany({ where: { projectId: req.params.projectId } }));
  }),
);

router.put(
  '/:projectId/budget',
  requireSuperadmin,
  requireProjectAccess,
  asyncHandler(async (req, res) => {
    const { lines } = budgetSchema.parse(req.body);
    const projectId = req.params.projectId;
    const result = await prisma.$transaction(
      lines.map((line) =>
        prisma.budgetLine.upsert({
          where: { projectId_category: { projectId, category: line.category } },
          create: { projectId, category: line.category, allocated: line.allocated },
          update: { allocated: line.allocated },
        }),
      ),
    );
    audit(req, 'budget.set', 'Project', projectId, { lines });
    res.json(result);
  }),
);

router.get(
  '/:projectId/financials',
  requireProjectAccess,
  asyncHandler(async (req, res) => {
    res.json(await projectFinancials(req.params.projectId));
  }),
);

export default router;
