import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { projectScope, requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { projectFinancials } from '../services/finance';

const router = Router();
router.use(requireAuth);

const projectSchema = z.object({
  name: z.string().min(1),
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
    const data = projectSchema.parse(req.body);
    const project = await prisma.project.create({ data, include });
    audit(req, 'project.create', 'Project', project.id, { name: project.name });
    res.status(201).json(project);
  }),
);

router.get(
  '/:projectId',
  requireProjectAccess,
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
    await prisma.project.delete({ where: { id: req.params.projectId } });
    audit(req, 'project.delete', 'Project', req.params.projectId);
    res.json({ ok: true });
  }),
);

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
