import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';

/**
 * The client register — the single place a customer is entered.
 *
 * This is the head of the "enter it once" chain: a client recorded here is
 * reused by every lead, quotation, contract and project that follows, so the
 * name, KRA PIN and address are typed once and then only ever selected.
 *
 * Superadmin-only, matching payments and invoicing: client contact details and
 * their contract history are commercial data a site supervisor has no business
 * with.
 */
const router = Router();
router.use(requireAuth, requireSuperadmin);

const clientSchema = z.object({
  name: z.string().min(1, 'A client needs a name'),
  contactPerson: z.string().optional(),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  kraPin: z.string().optional(),
  notes: z.string().optional(),
});

/** Empty strings from HTML forms mean "not given", not "set to empty". */
function normalise(data: z.infer<typeof clientSchema>) {
  const blankToNull = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    name: data.name.trim(),
    contactPerson: blankToNull(data.contactPerson),
    email: blankToNull(data.email),
    phone: blankToNull(data.phone),
    address: blankToNull(data.address),
    kraPin: blankToNull(data.kraPin),
    notes: blankToNull(data.notes),
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { q } = z.object({ q: z.string().optional() }).parse(req.query);

    const clients = await prisma.client.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { contactPerson: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      include: {
        _count: { select: { leads: true, quotations: true, contracts: true, projects: true } },
        projects: { select: { contractValue: true } },
      },
      orderBy: { name: 'asc' },
      take: 500,
    });

    res.json(
      clients.map(({ projects, ...c }) => ({
        ...c,
        // Lifetime value: what this client has actually put under contract.
        totalContractValue: projects.reduce((s, p) => s + Number(p.contractValue), 0),
      })),
    );
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: {
        leads: { orderBy: { createdAt: 'desc' }, take: 50 },
        quotations: {
          select: {
            id: true,
            quotationNo: true,
            title: true,
            status: true,
            issueDate: true,
            total: true,
          },
          orderBy: { issueDate: 'desc' },
          take: 50,
        },
        contracts: {
          select: {
            id: true,
            contractNo: true,
            title: true,
            status: true,
            originalValue: true,
            startDate: true,
            projectId: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        projects: {
          select: { id: true, code: true, name: true, status: true, contractValue: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!client) throw ApiError.notFound();

    res.json({
      ...client,
      leads: client.leads.map((l) => ({
        ...l,
        estimatedValue: l.estimatedValue === null ? null : Number(l.estimatedValue),
      })),
      quotations: client.quotations.map((q) => ({ ...q, total: Number(q.total) })),
      contracts: client.contracts.map((c) => ({ ...c, originalValue: Number(c.originalValue) })),
      projects: client.projects.map((p) => ({ ...p, contractValue: Number(p.contractValue) })),
    });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = normalise(clientSchema.parse(req.body));
    const client = await prisma.client.create({ data });
    audit(req, 'client.create', 'Client', client.id, { name: client.name });
    res.status(201).json(client);
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = normalise(clientSchema.parse(req.body));
    const existing = await prisma.client.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound();

    const client = await prisma.client.update({ where: { id: existing.id }, data });
    // Renaming a client deliberately does NOT rewrite clientName on existing
    // projects, quotations or invoices. Those are snapshots of who the document
    // was addressed to when it was issued, and rewriting them would change the
    // meaning of documents that have already gone out.
    audit(req, 'client.update', 'Client', client.id, { name: client.name });
    res.json(client);
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { leads: true, quotations: true, contracts: true, projects: true } },
      },
    });
    if (!client) throw ApiError.notFound();

    // Quotations and contracts cascade from Client at the database level, so an
    // unguarded delete here would silently destroy issued, numbered documents.
    const { quotations, contracts, projects } = client._count;
    if (quotations > 0 || contracts > 0 || projects > 0) {
      throw ApiError.conflict(
        'This client has quotations, contracts or projects on file and cannot be deleted. ' +
          'Their history has to stay intact.',
      );
    }

    await prisma.client.delete({ where: { id: client.id } });
    audit(req, 'client.delete', 'Client', client.id, { name: client.name });
    res.json({ ok: true });
  }),
);

export default router;
