import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { projectScope, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { fileUrl, signFileUrl, upload, verifyUpload } from '../middleware/upload';

/**
 * Company-owned tools (paint brushes, drills, ladders...) that circulate
 * between sites, unlike per-project consumable StockItems. Transfers are
 * superadmin-only — a transfer touches two projects, and superadmin already
 * has universal visibility, so no cross-project RBAC helper is needed.
 * Supervisors get a read-only view of tools currently at their own site via
 * the same GET / endpoint, filtered server-side by role.
 */
const router = Router();
router.use(requireAuth);

const include = { currentProject: { select: { id: true, name: true } } } as const;

// SUPERADMIN sees every tool; SUPERVISOR sees only tools currently at their
// assigned site. A tool in central store (currentProjectId null) never
// matches a supervisor's nested filter, which is the desired behavior.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const where =
      req.user!.role === 'SUPERADMIN' ? {} : { currentProject: projectScope(req.user!) };
    res.json(await prisma.tool.findMany({ where, include, orderBy: { name: 'asc' } }));
  }),
);

const toolSchema = z.object({
  name: z.string().min(1),
  category: z.string().nullable().optional(),
  unit: z.string().min(1).default('pcs'),
  quantity: z.coerce.number().nonnegative(),
  currentProjectId: z.string().nullable().optional(),
  nextServiceDate: z.coerce.date().nullable().optional(),
});

router.post(
  '/',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const data = toolSchema.parse(req.body);
    if (data.currentProjectId) {
      const project = await prisma.project.findUnique({ where: { id: data.currentProjectId } });
      if (!project)
        throw ApiError.badRequest('currentProjectId does not reference an existing project');
    }
    const tool = await prisma.tool.create({ data, include });
    audit(req, 'tool.create', 'Tool', tool.id, { name: tool.name });
    res.status(201).json(tool);
  }),
);

const toolPatchSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().nullable().optional(),
  unit: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED']).optional(),
  conditionNotes: z.string().nullable().optional(),
  nextServiceDate: z.coerce.date().nullable().optional(),
});

// Catalog fields only — quantity/currentProjectId only ever change via
// /transfer, so every location change is guaranteed to be logged. status is
// the exception: a tool can go down for repair without moving anywhere.
router.patch(
  '/:id',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const data = toolPatchSchema.parse(req.body);
    const tool = await prisma.tool.update({ where: { id: req.params.id }, data, include });
    audit(req, 'tool.update', 'Tool', tool.id, data.status ? { status: data.status } : undefined);
    res.json(tool);
  }),
);

const transferSchema = z.object({
  toProjectId: z.string().min(1),
  transferDate: z.coerce.date().optional(),
  notes: z.string().nullable().optional(),
});

// multipart/form-data with a required `proofPhoto` file. Transfers are
// all-or-nothing: the tool's entire current quantity moves to the new site.
router.post(
  '/:id/transfer',
  requireSuperadmin,
  upload.single('proofPhoto'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('proofPhoto is required');
    const data = transferSchema.parse(req.body);

    const tool = await prisma.tool.findUnique({ where: { id: req.params.id } });
    if (!tool) throw ApiError.notFound('Tool not found');

    const toProject = await prisma.project.findUnique({ where: { id: data.toProjectId } });
    if (!toProject) throw ApiError.badRequest('toProjectId does not reference an existing project');
    if (tool.currentProjectId === data.toProjectId) {
      throw ApiError.badRequest('Tool is already at this project');
    }
    if (Number(tool.quantity) <= 0) {
      throw ApiError.badRequest('Tool has no quantity to transfer');
    }
    if (tool.status !== 'ACTIVE') {
      throw ApiError.conflict(
        `This tool is marked ${tool.status.toLowerCase()} and cannot be transferred`,
      );
    }

    await verifyUpload(req.file);

    const transfer = await prisma.$transaction(async (tx) => {
      const created = await tx.toolTransfer.create({
        data: {
          toolId: tool.id,
          fromProjectId: tool.currentProjectId,
          toProjectId: data.toProjectId,
          quantity: tool.quantity,
          transferDate: data.transferDate ?? new Date(),
          proofPhotoUrl: fileUrl(req.file!.filename),
          notes: data.notes || null,
          transferredById: req.user!.id,
        },
        include: {
          fromProject: { select: { id: true, name: true } },
          toProject: { select: { id: true, name: true } },
          transferredBy: { select: { id: true, name: true } },
        },
      });
      await tx.tool.update({
        where: { id: tool.id },
        data: { currentProjectId: data.toProjectId },
      });
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'tool.transfer',
          entity: 'Tool',
          entityId: tool.id,
          meta: {
            fromProjectId: tool.currentProjectId,
            toProjectId: data.toProjectId,
            quantity: Number(tool.quantity),
          },
          ip: req.ip,
        },
      });
      return created;
    });

    res.status(201).json({ ...transfer, proofPhotoUrl: signFileUrl(transfer.proofPhotoUrl) });
  }),
);

router.get(
  '/:id/transfers',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const tool = await prisma.tool.findUnique({ where: { id: req.params.id } });
    if (!tool) throw ApiError.notFound('Tool not found');
    const transfers = await prisma.toolTransfer.findMany({
      where: { toolId: tool.id },
      include: {
        fromProject: { select: { id: true, name: true } },
        toProject: { select: { id: true, name: true } },
        transferredBy: { select: { id: true, name: true } },
      },
      orderBy: { transferDate: 'desc' },
      take: 500,
    });
    res.json(transfers.map((t) => ({ ...t, proofPhotoUrl: signFileUrl(t.proofPhotoUrl) })));
  }),
);

export default router;
