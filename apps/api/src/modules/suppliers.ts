import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireFinanceRole } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import {
  loadSupplierLedger,
  payablesSummary,
  paymentSettles,
  supplierPositions,
} from '../services/payables';
import { generateToken, hashToken } from '../services/accessLink';

/**
 * Suppliers and the payables ledger.
 *
 * Superadmin-only throughout, matching invoices.ts and payments.ts: what the
 * company owes, and to whom, is financial data a site supervisor must never
 * see. A supervisor submits an expense; the office decides what is owed on it.
 */
const router = Router();
router.use(requireAuth, requireFinanceRole);

const supplierSchema = z.object({
  name: z.string().min(1, 'A supplier needs a name').trim(),
  contactName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email('That is not a valid email').optional().or(z.literal('')),
  kraPin: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  active: z.coerce.boolean().optional(),
});

/**
 * A supplier's balance, aging position and bill history — the exact shape
 * `GET /:id` returns. Exported so the public statement link
 * (publicStatement.ts) shows the client this same view, not a second
 * hand-rolled one that could drift from it.
 */
export async function buildSupplierStatement(supplierId: string) {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return null;

  const { costs, paymentsByCost } = await loadSupplierLedger({ supplierId: supplier.id });
  const [position] = supplierPositions(costs, paymentsByCost);

  // Every bill against this supplier, newest first, with its own position.
  const bills = await prisma.expense.findMany({
    where: { supplierId: supplier.id },
    include: {
      project: { select: { id: true, name: true } },
      payments: {
        orderBy: { paymentDate: 'desc' },
        include: { paidBy: { select: { id: true, name: true } } },
      },
    },
    orderBy: { expenseDate: 'desc' },
    take: 500,
  });

  return {
    ...supplier,
    position: position ?? null,
    bills: bills.map((b) => ({
      id: b.id,
      projectId: b.projectId,
      project: b.project,
      description: b.description,
      supplierInvoiceNo: b.supplierInvoiceNo,
      amount: Number(b.amount),
      vatAmount: Number(b.vatAmount),
      taxInvoice: b.taxInvoice,
      expenseDate: b.expenseDate,
      dueDate: b.dueDate,
      status: b.status,
      paid: b.payments.reduce(
        (s, p) =>
          s +
          paymentSettles({
            amount: Number(p.amount),
            whtAmount: Number(p.whtAmount),
            whtVatAmount: Number(p.whtVatAmount),
          }),
        0,
      ),
    })),
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { includeInactive } = z
      .object({ includeInactive: z.enum(['true', 'false']).optional() })
      .parse(req.query);

    const [suppliers, ledger] = await Promise.all([
      prisma.supplier.findMany({
        where: includeInactive === 'true' ? {} : { active: true },
        orderBy: { name: 'asc' },
      }),
      loadSupplierLedger(),
    ]);
    const positions = new Map(
      supplierPositions(ledger.costs, ledger.paymentsByCost).map((p) => [p.supplierId, p]),
    );

    res.json(
      suppliers.map((s) => ({
        ...s,
        // A supplier with no bills is a real state, not a missing figure.
        position: positions.get(s.id) ?? null,
      })),
    );
  }),
);

/**
 * The company-wide payables position: who is owed what, and for how long.
 *
 * Registered before /:id so "payables" is never read as a supplier id.
 */
router.get(
  '/payables',
  asyncHandler(async (_req, res) => {
    const { costs, paymentsByCost } = await loadSupplierLedger();
    const positions = supplierPositions(costs, paymentsByCost);
    const names = new Map(
      (
        await prisma.supplier.findMany({
          where: { id: { in: positions.map((p) => p.supplierId) } },
          select: { id: true, name: true, phone: true },
        })
      ).map((s) => [s.id, s]),
    );

    res.json({
      summary: payablesSummary(positions),
      suppliers: positions.map((p) => ({
        ...p,
        name: names.get(p.supplierId)?.name ?? 'Unknown supplier',
        phone: names.get(p.supplierId)?.phone ?? null,
      })),
    });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = supplierSchema.parse(req.body);
    const existing = await prisma.supplier.findUnique({ where: { name: data.name } });
    if (existing) {
      throw ApiError.conflict(
        `${data.name} is already on the supplier list${existing.active ? '' : ' (retired — reactivate it instead)'}`,
      );
    }
    const supplier = await prisma.supplier.create({
      data: { ...data, email: data.email || null },
    });
    audit(req, 'supplier.create', 'Supplier', supplier.id, { name: supplier.name });
    res.status(201).json({ ...supplier, position: null });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const statement = await buildSupplierStatement(req.params.id);
    if (!statement) throw ApiError.notFound('Supplier not found');
    res.json(statement);
  }),
);

/**
 * A reusable link a supplier can open with no login of their own to see
 * their own balance and bill history — same pattern as the contract
 * signing/quotation decision links, but not single-use: a statement is
 * read-only, meant to be reopened, so it stays valid until it expires or is
 * revoked rather than being consumed on first view.
 */
router.post(
  '/:id/statement-link',
  asyncHandler(async (req, res) => {
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!supplier) throw ApiError.notFound('Supplier not found');

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.supplierStatementLink.updateMany({
        where: { supplierId: supplier.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.supplierStatementLink.create({
        data: { supplierId: supplier.id, tokenHash, createdById: req.user!.id, expiresAt },
      }),
    ]);

    audit(req, 'supplier.statementLink.create', 'Supplier', supplier.id);
    res.status(201).json({ token, expiresAt });
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = supplierSchema.partial().parse(req.body);
    const existing = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('Supplier not found');

    if (data.name && data.name !== existing.name) {
      const clash = await prisma.supplier.findUnique({ where: { name: data.name } });
      if (clash) throw ApiError.conflict(`${data.name} is already on the supplier list`);
    }

    const supplier = await prisma.supplier.update({
      where: { id: existing.id },
      data: { ...data, ...(data.email !== undefined && { email: data.email || null }) },
    });
    audit(req, 'supplier.update', 'Supplier', supplier.id, { name: supplier.name });
    res.json(supplier);
  }),
);

/**
 * Retire a supplier rather than delete them.
 *
 * Their name is printed on costs that have already been reported, and a hard
 * delete would blank it on every one of those rows. A supplier still owed
 * money cannot be retired at all — hiding a debt does not settle it.
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!supplier) throw ApiError.notFound('Supplier not found');

    const { costs, paymentsByCost } = await loadSupplierLedger({ supplierId: supplier.id });
    const [position] = supplierPositions(costs, paymentsByCost);
    if (position && position.outstanding > 0) {
      throw ApiError.conflict(
        `${supplier.name} is still owed ${position.outstanding}. Settle the balance before retiring them.`,
      );
    }

    const retired = await prisma.supplier.update({
      where: { id: supplier.id },
      data: { active: false },
    });
    audit(req, 'supplier.retire', 'Supplier', supplier.id, { name: supplier.name });
    res.json(retired);
  }),
);

export default router;
