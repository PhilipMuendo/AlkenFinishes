import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { kes, sumCents, toCents } from './money';
import { companyReceivables, projectReceivables } from './invoicing';
import {
  payablesSummary,
  supplierPositions,
  type PayableCost,
  type PayablePayment,
} from './payables';
import { monthPeriod, taxPosition } from './taxPosition';
import { gatherDay, factsFor } from './dailyReportDraft';

/**
 * What the assistant is allowed to look up, and how.
 *
 * The central rule: a lookup calls the SAME code the screens call. Every figure
 * in an answer therefore came through the identical path as the figure on the
 * page, and the two cannot disagree. The model is never given a database, a
 * query language, or the ability to invent an aggregate — it picks from this
 * list and writes the sentence.
 *
 * The second rule is that a lookup runs AS THE ASKING USER. A chat box is a way
 * around every permission boundary in the app unless the retrieval layer
 * enforces the same ones the routes do: office-only money, supervisors limited
 * to their own sites. `scope` below is that enforcement, and it is checked here
 * rather than trusted to the prompt — a model talked out of a rule is a bad
 * afternoon; a model that never had the data is not.
 */

export interface ChatUser {
  id: string;
  role: string;
}

export type Scope =
  /** Company money and cross-site totals. Office only. */
  | 'office'
  /** One site. Supervisors may use it for sites they are assigned to. */
  | 'site';

export interface LookupResult {
  /** Plain readable facts. This is what the model sees. */
  facts: string;
  /** Where a person can go to check them. */
  source?: { label: string; href: string };
}

export interface Lookup {
  name: string;
  scope: Scope;
  /** Shown to the model so it can choose. Keep it about the QUESTION it answers. */
  description: string;
  /** Argument names, for the planner. `projectId` is supplied for every 'site' lookup. */
  args?: string[];
  run: (ctx: { user: ChatUser; projectId?: string; args: Record<string, string> }) => Promise<LookupResult>;
}

const money = (n: number) =>
  `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const day = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : 'not set';

/** Costs and their payments, for the payables math. Mirrors modules/suppliers.ts. */
async function loadLedger(where: Prisma.ExpenseWhereInput = {}) {
  const expenses = await prisma.expense.findMany({
    where: { supplierId: { not: null }, ...where },
    select: {
      id: true,
      supplierId: true,
      amount: true,
      vatAmount: true,
      taxInvoice: true,
      dueDate: true,
      expenseDate: true,
      payments: { select: { amount: true, whtAmount: true, whtVatAmount: true } },
    },
  });
  const costs: PayableCost[] = expenses.map((e) => ({
    id: e.id,
    supplierId: e.supplierId,
    amount: Number(e.amount),
    vatAmount: Number(e.vatAmount),
    taxInvoice: e.taxInvoice,
    dueDate: e.dueDate,
    expenseDate: e.expenseDate,
  }));
  const paymentsByCost = new Map<string, PayablePayment[]>(
    expenses.map((e) => [
      e.id,
      e.payments.map((p) => ({
        amount: Number(p.amount),
        whtAmount: Number(p.whtAmount),
        whtVatAmount: Number(p.whtVatAmount),
      })),
    ]),
  );
  return { costs, paymentsByCost };
}

export class RetrievalDenied extends Error {}

export const LOOKUPS: Lookup[] = [
  {
    name: 'company_overview',
    scope: 'office',
    description:
      'The state of the business right now: how many sites are running, what is owed to us, what we owe, and what is overdue on both sides.',
    run: async () => {
      const [projects, receivables, ledger] = await Promise.all([
        prisma.project.findMany({ select: { status: true } }),
        companyReceivables(),
        loadLedger(),
      ]);
      const payables = payablesSummary(supplierPositions(ledger.costs, ledger.paymentsByCost));
      const active = projects.filter((p) => p.status === 'ACTIVE').length;

      return {
        facts: [
          `Sites: ${active} active, ${projects.length} in the portfolio.`,
          `Owed to us: ${money(receivables.totalAr)}, of which ${money(receivables.totalOverdue)} is overdue.`,
          `Retention held by clients: ${money(receivables.retentionHeld)}.`,
          `We owe suppliers: ${money(payables.outstanding)} across ${payables.openBills} open bills, of which ${money(payables.overdue)} is overdue.`,
          `Tax withheld from suppliers and owed to KRA: ${money(payables.taxWithheld)}.`,
        ].join('\n'),
        source: { label: 'Overview', href: '/admin' },
      };
    },
  },

  {
    name: 'site_status',
    scope: 'site',
    description:
      'How one site is going: its status, dates, who supervises it, how much of the programme is done, open defects, and when the last daily report came in.',
    run: async ({ projectId }) => {
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: {
          name: true,
          status: true,
          location: true,
          clientName: true,
          startDate: true,
          expectedCompletion: true,
          supervisor: { select: { name: true } },
        },
      });
      const [tasks, openSnags, lastReport] = await Promise.all([
        prisma.task.groupBy({ by: ['status'], where: { projectId }, _count: true }),
        prisma.snagItem.count({ where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS', 'REJECTED'] } } }),
        prisma.dailyReport.findFirst({
          where: { projectId },
          orderBy: { date: 'desc' },
          select: { date: true },
        }),
      ]);
      const count = (s: string) => tasks.find((t) => t.status === s)?._count ?? 0;
      const total = tasks.reduce((n, t) => n + t._count, 0);

      return {
        facts: [
          `Site: ${project.name} (${project.location}) for ${project.clientName}.`,
          `Status: ${project.status.toLowerCase().replace('_', ' ')}.`,
          `Programme: ${day(project.startDate)} to ${day(project.expectedCompletion)}.`,
          `Supervisor: ${project.supervisor?.name ?? 'nobody assigned'}.`,
          total > 0
            ? `Tasks: ${count('DONE')} done, ${count('IN_PROGRESS')} in progress, ${count('NOT_STARTED')} not started, ${count('BLOCKED')} blocked, out of ${total}.`
            : 'No tasks have been put on the programme.',
          `Open defects: ${openSnags}.`,
          lastReport
            ? `Last daily report: ${day(lastReport.date)}.`
            : 'No daily report has ever been filed for this site.',
        ].join('\n'),
        source: { label: project.name, href: `/admin/projects/${projectId}` },
      };
    },
  },

  {
    name: 'site_money',
    scope: 'office',
    description:
      'The money on one site: contract value, budget against actual spend, what has been invoiced and what the client still owes. Needs projectId.',
    args: ['projectId'],
    run: async ({ args }) => {
      const projectId = args.projectId;
      // Office scope skips the site check in runLookup, so guard here rather
      // than letting an undefined id reach Prisma as an opaque failure.
      if (!projectId) throw new RetrievalDenied('Which site do you mean?');
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { name: true, contractValue: true },
      });
      const [budget, expenses, receivables] = await Promise.all([
        prisma.budgetLine.findMany({ where: { projectId }, select: { allocated: true } }),
        prisma.expense.findMany({
          where: { projectId, status: 'APPROVED' },
          select: { amount: true },
        }),
        projectReceivables(projectId),
      ]);
      const allocated = kes(sumCents(budget.map((b) => toCents(b.allocated))));
      const spent = kes(sumCents(expenses.map((e) => toCents(e.amount))));

      return {
        facts: [
          `Site: ${project.name}.`,
          `Contract value: ${money(Number(project.contractValue))}.`,
          allocated > 0
            ? `Budget: ${money(allocated)} allocated, ${money(spent)} spent in approved expenses (${Math.round((spent / allocated) * 100)}%).`
            : `No budget has been set. Approved expenses so far: ${money(spent)}.`,
          `Invoiced and outstanding from the client: ${money(receivables.arOutstanding)}, of which ${money(receivables.arOverdue)} is overdue.`,
          `Retention held: ${money(receivables.retentionHeld)}.`,
        ].join('\n'),
        source: { label: `${project.name} — money`, href: `/admin/projects/${projectId}?tab=financials` },
      };
    },
  },

  {
    name: 'site_day',
    scope: 'site',
    description:
      'What was actually recorded on a site on a given day: who was there, which tasks moved, what was delivered, defects raised, safety incidents. Takes a date (YYYY-MM-DD), defaulting to today.',
    args: ['date'],
    run: async ({ projectId, args }) => {
      const date = args.date ? new Date(args.date) : new Date();
      if (Number.isNaN(date.getTime())) throw new Error('bad date');
      const summary = await gatherDay(projectId!, date);
      return {
        facts: summary.empty
          ? `Nothing at all was recorded on ${day(date)} at ${summary.projectName} — no attendance, tasks, deliveries or defects.`
          : `On ${day(date)}:\n${factsFor(summary)}`,
        source: {
          label: `${summary.projectName} — daily reports`,
          href: `/admin/projects/${projectId}?tab=reports`,
        },
      };
    },
  },

  {
    name: 'who_we_owe',
    scope: 'office',
    description:
      'Which suppliers are owed money, how much, and how late it is. Biggest debt first.',
    run: async () => {
      const { costs, paymentsByCost } = await loadLedger();
      const positions = supplierPositions(costs, paymentsByCost).filter((p) => p.outstanding > 0);
      const names = new Map(
        (
          await prisma.supplier.findMany({
            where: { id: { in: positions.map((p) => p.supplierId) } },
            select: { id: true, name: true },
          })
        ).map((s) => [s.id, s.name]),
      );
      const summary = payablesSummary(positions);

      return {
        facts:
          positions.length === 0
            ? 'Nothing is outstanding to any supplier.'
            : [
                `Total owed to suppliers: ${money(summary.outstanding)} across ${positions.length} suppliers, ${money(summary.overdue)} of it overdue.`,
                ...positions
                  .slice(0, 10)
                  .map(
                    (p) =>
                      `${names.get(p.supplierId) ?? 'Unknown supplier'}: ${money(p.outstanding)} owed across ${p.openBills} bill${p.openBills === 1 ? '' : 's'}` +
                      (p.overdue > 0
                        ? `, ${money(p.overdue)} overdue by up to ${p.oldestOverdueDays} days.`
                        : ', none overdue.'),
                  ),
              ].join('\n'),
        source: { label: 'Payables', href: '/admin/suppliers' },
      };
    },
  },

  {
    name: 'who_owes_us',
    scope: 'office',
    description: 'Which client invoices are unpaid or overdue, and by how much.',
    run: async () => {
      const invoices = await prisma.invoice.findMany({
        where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, voidedAt: null },
        select: {
          invoiceNo: true,
          clientName: true,
          dueDate: true,
          netPayable: true,
          project: { select: { name: true } },
          payments: {
            where: { voidedAt: null },
            select: { amount: true, whtAmount: true, whtVatAmount: true },
          },
        },
        orderBy: { dueDate: 'asc' },
        take: 200,
      });

      const today = new Date();
      const rows = invoices
        .map((i) => {
          // Withheld tax settles an invoice exactly as cash does — counting
          // only cash is what made invoices look unpaid after a certificate.
          const settled = sumCents(
            i.payments.map(
              (p) => toCents(p.amount) + toCents(p.whtAmount) + toCents(p.whtVatAmount),
            ),
          );
          const balance = kes(Math.max(0, toCents(i.netPayable) - settled));
          const daysLate = Math.floor(
            (today.getTime() - new Date(i.dueDate).getTime()) / 86_400_000,
          );
          return { ...i, balance, daysLate };
        })
        .filter((r) => r.balance > 0);

      const total = rows.reduce((n, r) => n + r.balance, 0);
      const overdue = rows.filter((r) => r.daysLate > 0);

      return {
        facts:
          rows.length === 0
            ? 'Every issued invoice has been settled.'
            : [
                `Outstanding from clients: ${money(total)} across ${rows.length} invoices; ${overdue.length} are past their due date.`,
                ...rows
                  .slice(0, 10)
                  .map(
                    (r) =>
                      `${r.invoiceNo ?? 'Unnumbered'} — ${r.clientName} (${r.project.name}): ${money(r.balance)} outstanding, due ${day(r.dueDate)}` +
                      (r.daysLate > 0 ? `, ${r.daysLate} days late.` : '.'),
                  ),
              ].join('\n'),
        source: { label: 'Receivables', href: '/admin/invoices' },
      };
    },
  },

  {
    name: 'tax_position',
    scope: 'office',
    description:
      'VAT and withholding for a month: VAT charged out, VAT reclaimable, tax held for KRA, tax clients withheld from us. Takes a month as YYYY-MM, defaulting to this month.',
    args: ['month'],
    run: async ({ args }) => {
      let period = monthPeriod();
      if (args.month && /^\d{4}-\d{2}$/.test(args.month)) {
        const [y, m] = args.month.split('-').map(Number);
        period = monthPeriod(new Date(y, m - 1, 15));
      }
      const pos = await taxPosition(period);

      return {
        facts: [
          `VAT period ${period.from.toISOString().slice(0, 7)}:`,
          `Output VAT charged to clients: ${money(pos.vat.outputVat)}.`,
          `Input VAT reclaimable (backed by a tax invoice): ${money(pos.vat.inputVatReclaimable)}.`,
          pos.vat.inputVatUnsupported > 0
            ? `Input VAT with no supplier tax invoice, so not reclaimable: ${money(pos.vat.inputVatUnsupported)}.`
            : '',
          `Net VAT ${pos.vat.netVatPayable >= 0 ? 'payable to KRA' : 'credit carried forward'}: ${money(Math.abs(pos.vat.netVatPayable))}.`,
          `Withheld from suppliers and not yet remitted: ${money(pos.withholding.notYetRemitted)}.`,
          `Withheld by clients on our behalf: ${money(pos.withholding.withheldByClients)}, of which ${money(pos.withholding.certificatesOutstanding)} has no certificate yet.`,
        ]
          .filter(Boolean)
          .join('\n'),
        source: { label: 'Tax position', href: '/admin/tax' },
      };
    },
  },

  {
    name: 'payroll_recent',
    scope: 'office',
    description: 'The most recent payroll runs: period, how many workers, gross, net paid.',
    run: async () => {
      const runs = await prisma.payrollRun.findMany({
        orderBy: { periodTo: 'desc' },
        take: 6,
        select: {
          periodFrom: true,
          periodTo: true,
          status: true,
          project: { select: { name: true } },
          lines: { select: { gross: true, netPay: true } },
        },
      });
      return {
        facts:
          runs.length === 0
            ? 'No payroll run has been created yet.'
            : runs
                .map((r) => {
                  const gross = kes(sumCents(r.lines.map((l) => toCents(l.gross))));
                  const net = kes(sumCents(r.lines.map((l) => toCents(l.netPay))));
                  return `${day(r.periodFrom)} to ${day(r.periodTo)} (${r.project?.name ?? 'all sites'}), ${r.status.toLowerCase()}: ${r.lines.length} workers, ${money(gross)} gross, ${money(net)} net paid.`;
                })
                .join('\n'),
        source: { label: 'Payroll', href: '/admin/payroll' },
      };
    },
  },
];

export const LOOKUP_BY_NAME = new Map(LOOKUPS.map((l) => [l.name, l]));

/** Lookups this user is allowed to use at all. */
export function lookupsFor(user: ChatUser): Lookup[] {
  return LOOKUPS.filter((l) => l.scope !== 'office' || user.role === 'SUPERADMIN');
}

/** The sites this user may ask about — the same scoping the project routes use. */
export async function visibleProjects(user: ChatUser) {
  return prisma.project.findMany({
    where: user.role === 'SUPERADMIN' ? {} : { supervisorId: user.id },
    select: { id: true, name: true, status: true },
    orderBy: { name: 'asc' },
  });
}

/**
 * Run one lookup on behalf of a user.
 *
 * Every path out of here re-checks permission. A planner that asks for
 * `site_money` on a site the supervisor cannot see gets a refusal, not data —
 * which is the difference between a chat box and a hole in the RBAC.
 */
export async function runLookup(
  user: ChatUser,
  name: string,
  args: Record<string, string>,
  allowedProjectIds: Set<string>,
): Promise<LookupResult> {
  const lookup = LOOKUP_BY_NAME.get(name);
  if (!lookup) throw new RetrievalDenied(`No such lookup: ${name}`);

  if (lookup.scope === 'office' && user.role !== 'SUPERADMIN') {
    throw new RetrievalDenied('That is office-only information.');
  }

  let projectId: string | undefined;
  if (lookup.scope === 'site' || args.projectId) {
    projectId = args.projectId;
    if (!projectId) throw new RetrievalDenied('That lookup needs a site.');
    if (!allowedProjectIds.has(projectId)) {
      throw new RetrievalDenied('You do not have access to that site.');
    }
  }

  return lookup.run({ user, projectId, args });
}

/** The catalogue, as the planning step sees it. */
export function catalogueFor(user: ChatUser): string {
  return lookupsFor(user)
    .map((l) => {
      const args = [...(l.scope === 'site' ? ['projectId'] : []), ...(l.args ?? [])];
      return `- ${l.name}(${args.join(', ')}): ${l.description}`;
    })
    .join('\n');
}
