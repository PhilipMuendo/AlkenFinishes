import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { kes, sumCents, toCents } from './money';
import { companyReceivables, projectReceivables } from './invoicing';
import {
  payablesSummary,
  paymentSettles,
  supplierPositions,
  type PayableCost,
  type PayablePayment,
} from './payables';
import { monthPeriod, taxPosition } from './taxPosition';
import { gatherDay, factsFor } from './dailyReportDraft';
import { isOffice } from './payVisibility';
import { contractPosition, leadPipeline } from './pipeline';
import { projectFinancials, getFinanceSettings, monthlyTotals, toSeries } from './finance';
import { derivedEvents } from './calendarFeeds';
import { attentionDigest, FINISHING_SOON_DAYS } from './attention';
import {
  accruedByWorker,
  workerPosition,
  workerPayablesSummary,
  type WorkerPaymentRecord,
} from './workerPay';

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
 *
 * ---------------------------------------------------------------------------
 * ADDING A FEATURE? ADD ITS LOOKUP HERE, IN THE SAME CHANGE.
 *
 * This list is the whole of what the assistant can know. There is no fallback
 * and no schema access: a table with no lookup does not exist as far as anyone
 * asking a question is concerned, and it fails silently — the assistant says
 * the information "is not stated", which reads as a broken assistant rather
 * than a missing entry here.
 *
 * See "Adding a feature means adding a lookup" in docs/ARCHITECTURE.md for the
 * rules; the short version is: call the same service function the screen
 * calls, pick the scope honestly, keep rates on the office side of
 * services/payVisibility.ts, write `facts` for a reader, and add the name to
 * the coverage test in projectChat.test.ts.
 * ---------------------------------------------------------------------------
 */

export interface ChatUser {
  id: string;
  role: string;
}

export type Scope =
  /** Company money and cross-site totals. Office only. */
  | 'office'
  /** One site. Supervisors may use it for sites they are assigned to. */
  | 'site'
  /**
   * Everyone, across whatever they can see. There is no projectId to check, so
   * `runLookup` cannot do the scoping for these — the lookup MUST narrow to
   * `ctx.allowedProjectIds` itself, and must not report anything the office
   * keeps to itself. Only for questions whose answer is inherently a list of
   * the user's own things: which sites are mine, who works on them.
   */
  | 'shared';

export interface LookupResult {
  /** Plain readable facts. This is what the model sees. */
  facts: string;
  /** Where a person can go to check them. */
  source?: { label: string; href: string };
}

export interface LookupContext {
  user: ChatUser;
  projectId?: string;
  args: Record<string, string>;
  /** The sites this user may see. The scoping a 'shared' lookup must apply. */
  allowedProjectIds: Set<string>;
}

export interface Lookup {
  name: string;
  scope: Scope;
  /** Shown to the model so it can choose. Keep it about the QUESTION it answers. */
  description: string;
  /** Argument names, for the planner. `projectId` is supplied for every 'site' lookup. */
  args?: string[];
  run: (ctx: LookupContext) => Promise<LookupResult>;
}

const money = (n: number) =>
  `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const day = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : 'not set';

/**
 * Today's date on site, in the frame a date-only column is stored in.
 *
 * `@db.Date` values sit at UTC midnight, so anything compared against one has
 * to be built the same way — but the day itself has to be the day in Nairobi,
 * or every question asked before 3am is answered about yesterday.
 */
const today = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
};

/**
 * A YYYY-MM-DD argument from the planner, as a date-only value.
 *
 * Built from the digits rather than handed to `new Date`, whose result for a
 * bare date depends on the server's timezone — the class of bug that put a
 * whole day's attendance outside its own range.
 */
const parseDateArg = (iso: string | undefined): Date | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? '').trim());
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const DAY_MS = 86_400_000;

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

/** A count with the right noun, so the model is never handed "1 defects". */
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const titleCase = (s: string) => s.toLowerCase().replace(/_/g, ' ');

/** Tally by key, biggest first — the shape most of these answers take. */
function tally<T>(rows: T[], key: (row: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** Cap a list in the facts, and say what was left out rather than truncating silently. */
function listed(lines: string[], limit: number): string[] {
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `…and ${lines.length - limit} more.`];
}

/**
 * Narrow a query to the sites this user may see.
 *
 * The office sees everything; a supervisor sees the sites they run. This is
 * the same rule `visibleProjects` applies, expressed as a where-clause for
 * lookups that count across sites rather than listing them.
 */
const withinScope = (ctx: LookupContext): Prisma.ProjectWhereInput =>
  isOffice(ctx.user.role) ? {} : { id: { in: [...ctx.allowedProjectIds] } };

const scopedProjectIds = (ctx: LookupContext) => ({ in: [...ctx.allowedProjectIds] });

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
      const [project, fin, receivables] = await Promise.all([
        prisma.project.findUniqueOrThrow({
          where: { id: projectId },
          select: { name: true, contractValue: true },
        }),
        // Same function site_spend and the Financials tab use — summing
        // approved expenses directly here (as this lookup used to) double
        // counted labour whenever it is also accrued from attendance.
        projectFinancials(projectId),
        projectReceivables(projectId),
      ]);

      return {
        facts: [
          `Site: ${project.name}.`,
          `Contract value: ${money(Number(project.contractValue))}.`,
          fin.totalBudget > 0
            ? `Budget: ${money(fin.totalBudget)} allocated, ${money(fin.totalActual)} actual spend${fin.overallConsumedPct != null ? ` (${fin.overallConsumedPct}%)` : ''}.`
            : `No budget has been set. Actual spend so far: ${money(fin.totalActual)}.`,
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
    name: 'owed_to_staff',
    scope: 'office',
    description:
      'What casual/contracted staff (fundis paid for hours worked, not on formal Payroll) are owed from attendance, what has been paid, and tax withheld from them. Biggest balance first.',
    run: async () => {
      const workers = await prisma.worker.findMany({ select: { id: true, name: true, trade: true } });
      const [accrued, payments] = await Promise.all([
        accruedByWorker(),
        prisma.workerPayment.findMany({ select: { workerId: true, amount: true, whtAmount: true } }),
      ]);
      const paymentsByWorker = new Map<string, { amount: number; whtAmount: number }[]>();
      for (const p of payments) {
        const list = paymentsByWorker.get(p.workerId) ?? [];
        list.push({ amount: Number(p.amount), whtAmount: Number(p.whtAmount) });
        paymentsByWorker.set(p.workerId, list);
      }
      const positions = workers
        .map((w) => ({ worker: w, ...workerPosition(accrued.get(w.id) ?? 0, paymentsByWorker.get(w.id) ?? []) }))
        .filter((p) => p.outstanding > 0)
        .sort((a, b) => b.outstanding - a.outstanding);
      const summary = workerPayablesSummary(positions);

      return {
        facts:
          positions.length === 0
            ? 'Nothing is currently owed to any worker.'
            : [
                `Total owed to staff: ${money(summary.outstanding)} across ${positions.length} workers. Tax withheld from staff and held for KRA: ${money(summary.taxWithheld)}.`,
                ...positions
                  .slice(0, 10)
                  .map((p) => `${p.worker.name} (${p.worker.trade}): ${money(p.outstanding)} owed.`),
              ].join('\n'),
        source: { label: 'Staff payables', href: '/admin/workers' },
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
      'VAT and withholding for a month: VAT charged out, VAT reclaimable, tax withheld from suppliers and from staff and held for KRA, tax clients withheld from us. Takes a month as YYYY-MM, defaulting to this month.',
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
          `Withheld from staff and not yet remitted: ${money(pos.withholding.staffNotYetRemitted)}.`,
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

  // ---- Sites and people ----------------------------------------------------

  {
    name: 'sites_list',
    scope: 'shared',
    description:
      'The list of sites by name — which are active, on hold, completed or in planning, who the client is, who supervises each and how far along it is. Use this whenever the question asks WHICH sites rather than about one site.',
    run: async (ctx) => {
      const projects = await prisma.project.findMany({
        where: withinScope(ctx),
        select: {
          name: true,
          code: true,
          status: true,
          clientName: true,
          location: true,
          progressPct: true,
          expectedCompletion: true,
          supervisor: { select: { name: true } },
        },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
      });

      const byStatus = tally(projects, (p) => p.status);
      return {
        facts:
          projects.length === 0
            ? 'There are no sites on the system.'
            : [
                `${plural(projects.length, 'site')} in total: ${byStatus
                  .map(([s, n]) => `${n} ${titleCase(s)}`)
                  .join(', ')}.`,
                ...listed(
                  projects.map(
                    (p) =>
                      `${p.name}${p.code ? ` (${p.code})` : ''} — ${titleCase(p.status)}, for ${p.clientName} at ${p.location}, ${p.progressPct}% complete, due ${day(p.expectedCompletion)}, supervised by ${p.supervisor?.name ?? 'nobody'}.`,
                  ),
                  25,
                ),
              ].join('\n'),
        source: { label: 'Sites', href: '/admin/projects' },
      };
    },
  },

  {
    name: 'workforce',
    scope: 'shared',
    description:
      'The fundis: how many there are, what trades they work in, how many are active, and which sites they are assigned to. Answers "how many workers do we have".',
    run: async (ctx) => {
      const office = isOffice(ctx.user.role);
      // A supervisor sees the people on their own sites, not the company roll.
      const workers = await prisma.worker.findMany({
        where: office
          ? {}
          : { assignments: { some: { endDate: null, projectId: scopedProjectIds(ctx) } } },
        select: {
          name: true,
          trade: true,
          status: true,
          assignments: {
            where: { endDate: null },
            select: { project: { select: { name: true } } },
          },
        },
        orderBy: { name: 'asc' },
      });

      const active = workers.filter((w) => w.status === 'ACTIVE');
      const assigned = workers.filter((w) => w.assignments.length > 0);
      const byTrade = tally(active, (w) => w.trade);
      const bySite = tally(
        assigned.flatMap((w) => w.assignments),
        (a) => a.project.name,
      );

      return {
        facts:
          workers.length === 0
            ? office
              ? 'No workers have been registered.'
              : 'No workers are currently assigned to your sites.'
            : [
                office
                  ? `${plural(workers.length, 'worker')} on the books: ${active.length} active, ${workers.length - active.length} inactive.`
                  : `${plural(workers.length, 'worker')} currently assigned to your sites.`,
                byTrade.length
                  ? `Trades (active workers): ${byTrade.map(([t, n]) => `${t} ${n}`).join(', ')}.`
                  : '',
                `${assigned.length} of them are assigned to a site right now; ${workers.length - assigned.length} are not on any site.`,
                bySite.length ? `By site: ${bySite.map(([s, n]) => `${s} ${n}`).join(', ')}.` : '',
                // Rates are the office's business — see services/payVisibility.
                office ? 'Pay rates are on the Workers screen.' : '',
              ]
                .filter(Boolean)
                .join('\n'),
        source: { label: 'Workers', href: office ? '/admin/workers' : '/supervisor' },
      };
    },
  },

  {
    name: 'site_attendance',
    scope: 'site',
    description:
      'Who has actually been turning up on a site and for how long, over a period. Takes from and to as YYYY-MM-DD, defaulting to the last 7 days.',
    args: ['from', 'to'],
    run: async ({ projectId, args, user }) => {
      const to = parseDateArg(args.to) ?? today();
      const from = parseDateArg(args.from) ?? new Date(to.getTime() - 6 * DAY_MS);

      const records = await prisma.attendanceRecord.findMany({
        where: { projectId, date: { gte: from, lte: to } },
        select: {
          date: true,
          hoursWorked: true,
          labourCost: true,
          checkOut: true,
          worker: { select: { name: true, trade: true } },
        },
      });
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { name: true },
      });

      const hours = records.reduce((n, r) => n + Number(r.hoursWorked ?? 0), 0);
      const people = new Set(records.map((r) => r.worker.name));
      const days = new Set(records.map((r) => day(r.date)));
      const stillIn = records.filter((r) => !r.checkOut).length;
      const perWorker = new Map<string, number>();
      for (const r of records) {
        perWorker.set(r.worker.name, (perWorker.get(r.worker.name) ?? 0) + Number(r.hoursWorked ?? 0));
      }

      return {
        facts:
          records.length === 0
            ? `No attendance was recorded at ${project.name} between ${day(from)} and ${day(to)}.`
            : [
                `Attendance at ${project.name}, ${day(from)} to ${day(to)}:`,
                `${plural(people.size, 'worker')} across ${plural(days.size, 'day')}, ${plural(records.length, 'shift')} in total.`,
                `Hours worked: ${hours.toFixed(1)}.`,
                stillIn > 0 ? `${plural(stillIn, 'shift has', 'shifts have')} no check-out recorded.` : '',
                // Cost divided by hours is the rate, so it goes with the rate.
                isOffice(user.role)
                  ? `Labour cost accrued: ${money(kes(sumCents(records.map((r) => toCents(r.labourCost ?? 0)))))}.`
                  : '',
                ...listed(
                  [...perWorker.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, h]) => `${name}: ${h.toFixed(1)} hours.`),
                  15,
                ),
              ]
                .filter(Boolean)
                .join('\n'),
        source: { label: `${project.name} — attendance`, href: `/admin/projects/${projectId}?tab=attendance` },
      };
    },
  },

  {
    name: 'team',
    scope: 'office',
    description:
      'The office and supervisory staff with logins — who they are, their role, and which sites each supervises.',
    run: async () => {
      const users = await prisma.user.findMany({
        select: {
          name: true,
          role: true,
          active: true,
          phone: true,
          projects: { select: { name: true, status: true } },
        },
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
      });
      const active = users.filter((u) => u.active);
      return {
        facts: [
          `${plural(users.length, 'user account')}: ${active.filter((u) => u.role === 'SUPERADMIN').length} office, ${active.filter((u) => u.role === 'SUPERVISOR').length} supervisors${users.length - active.length > 0 ? `, ${users.length - active.length} deactivated` : ''}.`,
          ...listed(
            active.map((u) => {
              const running = u.projects.filter((p) => p.status === 'ACTIVE').map((p) => p.name);
              return `${u.name} — ${u.role === 'SUPERADMIN' ? 'office' : 'supervisor'}${running.length ? `, running ${running.join(', ')}` : ', no active site'}.`;
            }),
            20,
          ),
        ].join('\n'),
        source: { label: 'Users', href: '/admin/users' },
      };
    },
  },

  // ---- What is happening on a site ----------------------------------------

  {
    name: 'site_programme',
    scope: 'site',
    description:
      'The task list for a site, phase by phase: what is done, in progress, blocked or not started, and how complete each phase is.',
    run: async ({ projectId }) => {
      const [project, tasks] = await Promise.all([
        prisma.project.findUniqueOrThrow({
          where: { id: projectId },
          select: { name: true, progressPct: true },
        }),
        prisma.task.findMany({
          where: { projectId },
          select: { phase: true, name: true, status: true, completionPct: true, notes: true },
          orderBy: [{ phase: 'asc' }, { sortOrder: 'asc' }],
        }),
      ]);

      const phases = new Map<string, typeof tasks>();
      for (const t of tasks) phases.set(t.phase, [...(phases.get(t.phase) ?? []), t]);
      const blocked = tasks.filter((t) => t.status === 'BLOCKED');

      return {
        facts:
          tasks.length === 0
            ? `No tasks have been put on the programme for ${project.name}.`
            : [
                `Programme for ${project.name} — overall ${project.progressPct}% complete, ${plural(tasks.length, 'task')} across ${plural(phases.size, 'phase')}.`,
                ...[...phases.entries()].map(([phase, rows]) => {
                  const done = rows.filter((t) => t.status === 'DONE').length;
                  return `${phase}: ${done}/${rows.length} done — ${rows.map((t) => `${t.name} (${titleCase(t.status)}, ${t.completionPct}%)`).join('; ')}.`;
                }),
                blocked.length
                  ? `Blocked: ${blocked.map((t) => `${t.name}${t.notes ? ` — ${t.notes}` : ''}`).join('; ')}.`
                  : 'Nothing is blocked.',
              ].join('\n'),
        source: { label: `${project.name} — programme`, href: `/admin/projects/${projectId}?tab=tasks` },
      };
    },
  },

  {
    name: 'site_defects',
    scope: 'site',
    description:
      'The snag list for a site: open defects, how serious they are, what is overdue, what has been sent back for rework, and what is waiting on the office to verify.',
    run: async ({ projectId }) => {
      const [project, snags] = await Promise.all([
        prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } }),
        prisma.snagItem.findMany({
          where: { projectId },
          select: {
            title: true,
            location: true,
            severity: true,
            status: true,
            dueDate: true,
            reworkCount: true,
            assignedTo: { select: { name: true } },
          },
          orderBy: [{ severity: 'desc' }, { dueDate: 'asc' }],
        }),
      ]);

      const open = snags.filter((s) => ['OPEN', 'IN_PROGRESS', 'REJECTED'].includes(s.status));
      const asAt = today();
      const overdue = open.filter((s) => s.dueDate && s.dueDate < asAt);
      const awaitingCheck = snags.filter((s) => s.status === 'RESOLVED');
      const rework = snags.filter((s) => s.reworkCount > 0);

      return {
        facts:
          snags.length === 0
            ? `No defects have been raised at ${project.name}.`
            : [
                `Defects at ${project.name}: ${plural(open.length, 'still open')} out of ${snags.length} ever raised.`,
                open.length
                  ? `By severity: ${tally(open, (s) => s.severity).map(([sev, n]) => `${n} ${titleCase(sev)}`).join(', ')}.`
                  : '',
                `${plural(overdue.length, 'is', 'are')} past the due date.`,
                `${plural(awaitingCheck.length, 'fix is', 'fixes are')} waiting for the office to verify.`,
                rework.length
                  ? `${plural(rework.length, 'defect has', 'defects have')} been sent back for rework at least once.`
                  : 'Nothing has been sent back for rework.',
                ...listed(
                  open.map(
                    (s) =>
                      `${titleCase(s.severity)}: ${s.title}${s.location ? ` (${s.location})` : ''} — ${titleCase(s.status)}, ${s.dueDate ? `due ${day(s.dueDate)}` : 'no due date'}, ${s.assignedTo ? `with ${s.assignedTo.name}` : 'unassigned'}.`,
                  ),
                  15,
                ),
              ]
                .filter(Boolean)
                .join('\n'),
        source: { label: `${project.name} — defects`, href: `/admin/projects/${projectId}?tab=snags` },
      };
    },
  },

  {
    name: 'site_safety',
    scope: 'site',
    description: 'Safety incidents and near misses recorded on a site, most recent first.',
    run: async ({ projectId }) => {
      const [project, incidents] = await Promise.all([
        prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } }),
        prisma.safetyIncident.findMany({
          where: { projectId },
          select: {
            occurredAt: true,
            severity: true,
            description: true,
            actionTaken: true,
            reportedBy: { select: { name: true } },
          },
          orderBy: { occurredAt: 'desc' },
          take: 30,
        }),
      ]);

      return {
        facts:
          incidents.length === 0
            ? `No safety incidents have been recorded at ${project.name}.`
            : [
                `Safety at ${project.name}: ${plural(incidents.length, 'incident')} recorded — ${tally(incidents, (i) => i.severity).map(([s, n]) => `${n} ${titleCase(s)}`).join(', ')}.`,
                ...listed(
                  incidents.map(
                    (i) =>
                      `${day(i.occurredAt)} — ${titleCase(i.severity)}: ${i.description}${i.actionTaken ? ` Action taken: ${i.actionTaken}` : ''} (reported by ${i.reportedBy.name}).`,
                  ),
                  12,
                ),
              ].join('\n'),
        source: { label: `${project.name} — safety`, href: `/admin/projects/${projectId}?tab=safety` },
      };
    },
  },

  {
    name: 'site_materials',
    scope: 'site',
    description:
      'Materials on a site: what is in stock and how much, plus material requests waiting on a decision or on delivery.',
    run: async ({ projectId }) => {
      const [project, stock, requests] = await Promise.all([
        prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } }),
        prisma.stockItem.findMany({
          where: { projectId },
          select: { name: true, unit: true, quantity: true },
          orderBy: { name: 'asc' },
        }),
        prisma.materialRequest.findMany({
          where: { projectId },
          select: {
            itemName: true,
            quantity: true,
            unit: true,
            status: true,
            neededBy: true,
            requestedBy: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 40,
        }),
      ]);

      const outstanding = requests.filter((r) => r.status === 'PENDING' || r.status === 'APPROVED');
      const empty = stock.filter((s) => Number(s.quantity) <= 0);

      return {
        facts: [
          `Materials at ${project.name}.`,
          stock.length
            ? `Stock (${plural(stock.length, 'line')}): ${stock.map((s) => `${s.name} ${Number(s.quantity)} ${s.unit}`).join(', ')}.`
            : 'Nothing is recorded in stock.',
          empty.length ? `Run out: ${empty.map((s) => s.name).join(', ')}.` : '',
          outstanding.length
            ? [
                `${plural(outstanding.length, 'request')} outstanding:`,
                ...listed(
                  outstanding.map(
                    (r) =>
                      `${r.itemName} ${Number(r.quantity)} ${r.unit} — ${titleCase(r.status)}${r.neededBy ? `, needed by ${day(r.neededBy)}` : ''} (asked for by ${r.requestedBy.name}).`,
                  ),
                  12,
                ),
              ].join('\n')
            : 'No material requests are outstanding.',
        ]
          .filter(Boolean)
          .join('\n'),
        source: { label: `${project.name} — materials`, href: `/admin/projects/${projectId}?tab=stock` },
      };
    },
  },

  {
    name: 'site_reports',
    scope: 'site',
    description:
      'The site diary: recent daily reports and weekly summaries for a site — what was written up, and whether reports are being filed at all.',
    run: async ({ projectId }) => {
      const [project, daily, weekly] = await Promise.all([
        prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } }),
        prisma.dailyReport.findMany({
          where: { projectId },
          select: {
            date: true,
            workCompleted: true,
            workersPresent: true,
            challenges: true,
            delays: true,
            submittedBy: { select: { name: true } },
          },
          orderBy: { date: 'desc' },
          take: 10,
        }),
        prisma.weeklyReport.findMany({
          where: { projectId },
          select: { weekEnding: true, summary: true, issues: true, nextWeekPlan: true },
          orderBy: { weekEnding: 'desc' },
          take: 4,
        }),
      ]);

      return {
        facts: [
          `Reports for ${project.name}: ${plural(daily.length, 'daily report')} and ${plural(weekly.length, 'weekly summary', 'weekly summaries')} most recently filed.`,
          ...daily.map(
            (r) =>
              `${day(r.date)} (${r.submittedBy.name}, ${plural(r.workersPresent, 'worker')} present): ${r.workCompleted}${r.challenges ? ` Challenges: ${r.challenges}` : ''}${r.delays ? ` Delays: ${r.delays}` : ''}`,
          ),
          ...weekly.map(
            (w) =>
              `Week ending ${day(w.weekEnding)}: ${w.summary}${w.issues ? ` Issues: ${w.issues}` : ''}${w.nextWeekPlan ? ` Next week: ${w.nextWeekPlan}` : ''}`,
          ),
        ].join('\n'),
        source: { label: `${project.name} — reports`, href: `/admin/projects/${projectId}?tab=reports` },
      };
    },
  },

  {
    name: 'site_documents',
    scope: 'site',
    description:
      'The document register for a site: what has been filed — contracts, approvals, receipts, completion certificates, photos — and when.',
    run: async ({ projectId }) => {
      const [project, docs] = await Promise.all([
        prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } }),
        prisma.document.findMany({
          where: { projectId },
          select: {
            name: true,
            type: true,
            createdAt: true,
            systemGenerated: true,
            uploadedBy: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 60,
        }),
      ]);

      return {
        facts:
          docs.length === 0
            ? `No documents have been filed against ${project.name}.`
            : [
                `${plural(docs.length, 'document')} filed against ${project.name}: ${tally(docs, (d) => d.type).map(([t, n]) => `${n} ${titleCase(t)}`).join(', ')}.`,
                ...listed(
                  docs.map(
                    (d) =>
                      `${d.name} (${titleCase(d.type)}) — ${day(d.createdAt)}, ${d.systemGenerated ? 'generated by the system' : `uploaded by ${d.uploadedBy.name}`}.`,
                  ),
                  20,
                ),
              ].join('\n'),
        source: { label: `${project.name} — documents`, href: `/admin/projects/${projectId}?tab=documents` },
      };
    },
  },

  {
    name: 'site_spend',
    scope: 'office',
    description:
      'Where the money went on a site: expenses by category, budget against actual, what is still awaiting approval, and the biggest individual costs. Needs projectId.',
    args: ['projectId'],
    run: async ({ args }) => {
      const projectId = args.projectId;
      if (!projectId) throw new RetrievalDenied('Which site do you mean?');
      const [fin, expenses, project] = await Promise.all([
        projectFinancials(projectId),
        prisma.expense.findMany({
          where: { projectId },
          select: {
            description: true,
            amount: true,
            expenseCategory: true,
            status: true,
            expenseDate: true,
            supplier: { select: { name: true } },
          },
          orderBy: { amount: 'desc' },
          take: 100,
        }),
        prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } }),
      ]);

      const approved = expenses.filter((e) => e.status === 'APPROVED');
      const pending = expenses.filter((e) => e.status === 'PENDING');
      const byCategory = new Map<string, number>();
      for (const e of approved) {
        byCategory.set(e.expenseCategory, (byCategory.get(e.expenseCategory) ?? 0) + Number(e.amount));
      }

      return {
        facts: [
          `Spend on ${project.name}.`,
          `Budget ${money(fin.totalBudget)}, actual ${money(fin.totalActual)}, remaining ${money(fin.totalRemaining)}${fin.overallConsumedPct != null ? ` (${fin.overallConsumedPct}% consumed, ${fin.overallHealth.toLowerCase()})` : ''}.`,
          `Contract value ${money(fin.contractValue)}, estimated profit at today's costs ${money(fin.estimatedProfit)}.`,
          `Labour from attendance: ${money(fin.attendanceLabourCost)}.`,
          byCategory.size
            ? `Approved expenses by category: ${[...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${titleCase(c)} ${money(v)}`).join(', ')}.`
            : 'No approved expenses.',
          pending.length
            ? `${plural(pending.length, 'expense')} still awaiting approval, worth ${money(pending.reduce((n, e) => n + Number(e.amount), 0))}.`
            : 'Nothing is awaiting approval.',
          ...listed(
            approved
              .slice(0, 10)
              .map(
                (e) =>
                  `${money(Number(e.amount))} — ${e.description}${e.supplier ? ` (${e.supplier.name})` : ''}, ${day(e.expenseDate)}.`,
              ),
            10,
          ),
        ]
          .filter(Boolean)
          .join('\n'),
        source: { label: `${project.name} — costs`, href: `/admin/projects/${projectId}?tab=financials` },
      };
    },
  },

  {
    name: 'site_invoices',
    scope: 'office',
    description:
      'Every invoice raised on one site and what has been paid against each, including retention and tax withheld by the client. Needs projectId.',
    args: ['projectId'],
    run: async ({ args }) => {
      const projectId = args.projectId;
      if (!projectId) throw new RetrievalDenied('Which site do you mean?');
      const [project, invoices] = await Promise.all([
        prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } }),
        prisma.invoice.findMany({
          where: { projectId },
          select: {
            invoiceNo: true,
            type: true,
            status: true,
            issueDate: true,
            dueDate: true,
            netPayable: true,
            retentionAmount: true,
            voidedAt: true,
            payments: {
              where: { voidedAt: null },
              select: { amount: true, whtAmount: true, whtVatAmount: true },
            },
          },
          orderBy: { issueDate: 'desc' },
        }),
      ]);

      return {
        facts:
          invoices.length === 0
            ? `No invoices have been raised on ${project.name}.`
            : [
                `Invoices on ${project.name}: ${plural(invoices.length, 'invoice')} — ${tally(invoices, (i) => i.status).map(([s, n]) => `${n} ${titleCase(s)}`).join(', ')}.`,
                ...listed(
                  invoices.map((i) => {
                    // Withheld tax settles a claim exactly as cash does.
                    const settled = sumCents(
                      i.payments.map(
                        (p) => toCents(p.amount) + toCents(p.whtAmount) + toCents(p.whtVatAmount),
                      ),
                    );
                    const balance = kes(Math.max(0, toCents(i.netPayable) - settled));
                    return `${i.invoiceNo ?? 'Draft (unnumbered)'} — ${titleCase(i.type)}, ${titleCase(i.status)}${i.voidedAt ? ' (voided)' : ''}: ${money(Number(i.netPayable))} payable, ${money(kes(settled))} settled, ${money(balance)} outstanding. Issued ${day(i.issueDate)}, due ${day(i.dueDate)}. Retention held ${money(Number(i.retentionAmount))}.`;
                  }),
                  20,
                ),
              ].join('\n'),
        source: { label: `${project.name} — invoices`, href: `/admin/projects/${projectId}?tab=financials` },
      };
    },
  },

  // ---- Commercial ----------------------------------------------------------

  {
    name: 'clients',
    scope: 'office',
    description:
      'The client list: who they are, how to reach them, how many sites each has with us and what each still owes.',
    run: async () => {
      const clients = await prisma.client.findMany({
        select: {
          name: true,
          contactPerson: true,
          phone: true,
          email: true,
          kraPin: true,
          projects: { select: { name: true, status: true } },
          _count: { select: { leads: true, quotations: true, contracts: true } },
        },
        orderBy: { name: 'asc' },
      });

      return {
        facts:
          clients.length === 0
            ? 'No clients have been added.'
            : [
                `${plural(clients.length, 'client')} on file.`,
                ...listed(
                  clients.map((c) => {
                    const active = c.projects.filter((p) => p.status === 'ACTIVE').length;
                    return `${c.name}${c.contactPerson ? ` (contact ${c.contactPerson})` : ''}${c.phone ? `, ${c.phone}` : ''}${c.email ? `, ${c.email}` : ''}${c.kraPin ? `, KRA PIN ${c.kraPin}` : ''} — ${plural(c.projects.length, 'site')} (${active} active), ${c._count.quotations} quotations, ${c._count.contracts} contracts.`;
                  }),
                  25,
                ),
              ].join('\n'),
        source: { label: 'Clients', href: '/admin/clients' },
      };
    },
  },

  {
    name: 'pipeline',
    scope: 'office',
    description:
      'Work we are chasing but have not won: leads by stage with their estimated value, and quotations out with the client — what is sent, accepted, rejected or about to expire.',
    run: async () => {
      const [leads, quotations, quoteRows] = await Promise.all([
        leadPipeline(),
        prisma.quotation.findMany({
          select: {
            quotationNo: true,
            title: true,
            status: true,
            total: true,
            validUntil: true,
            clientNameSnapshot: true,
          },
          orderBy: { issueDate: 'desc' },
          take: 40,
        }),
        prisma.lead.findMany({
          where: { stage: { notIn: ['WON', 'LOST'] } },
          select: {
            title: true,
            stage: true,
            estimatedValue: true,
            expectedCloseDate: true,
            client: { select: { name: true } },
          },
          orderBy: { expectedCloseDate: 'asc' },
          take: 20,
        }),
      ]);

      const asAt = today();
      const horizon = new Date(asAt.getTime() + 14 * DAY_MS);
      const live = quotations.filter((q) => q.status === 'SENT');
      const expiringSoon = live.filter((q) => q.validUntil >= asAt && q.validUntil <= horizon);

      return {
        facts: [
          `Pipeline: ${plural(leads.open, 'open lead')} worth ${money(leads.openValue)} in total.`,
          `By stage: ${Object.entries(leads.byStage).map(([s, v]) => `${titleCase(s)} ${v.count} (${money(v.value)})`).join(', ')}.`,
          ...listed(
            quoteRows.map(
              (l) =>
                `${l.title} for ${l.client.name} — ${titleCase(l.stage)}, ${l.estimatedValue ? money(Number(l.estimatedValue)) : 'no value estimated'}${l.expectedCloseDate ? `, expected to close ${day(l.expectedCloseDate)}` : ''}.`,
            ),
            10,
          ),
          quotations.length
            ? `Quotations: ${tally(quotations, (q) => q.status).map(([s, n]) => `${n} ${titleCase(s)}`).join(', ')}.`
            : 'No quotations have been raised.',
          expiringSoon.length
            ? `Expiring within 14 days: ${expiringSoon.map((q) => `${q.quotationNo ?? q.title} for ${q.clientNameSnapshot} (${money(Number(q.total))}, valid to ${day(q.validUntil)})`).join('; ')}.`
            : '',
          ...listed(
            live.map(
              (q) =>
                `${q.quotationNo ?? 'Draft'} — ${q.title} for ${q.clientNameSnapshot}: ${money(Number(q.total))}, valid to ${day(q.validUntil)}.`,
            ),
            10,
          ),
        ]
          .filter(Boolean)
          .join('\n'),
        source: { label: 'Pipeline', href: '/admin/leads' },
      };
    },
  },

  {
    name: 'contracts',
    scope: 'office',
    description:
      'Signed and issued contracts: contract sum, approved and pending variations, retention percentage, and where each sits in its defects liability period.',
    run: async () => {
      const contracts = await prisma.contract.findMany({
        select: {
          contractNo: true,
          title: true,
          status: true,
          originalValue: true,
          vatRatePct: true,
          retentionPct: true,
          defectsLiabilityMonths: true,
          practicalCompletionDate: true,
          signedDate: true,
          client: { select: { name: true } },
          project: { select: { name: true } },
          variations: { select: { amount: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });

      return {
        facts:
          contracts.length === 0
            ? 'No contracts have been raised.'
            : [
                `${plural(contracts.length, 'contract')}: ${tally(contracts, (c) => c.status).map(([s, n]) => `${n} ${titleCase(s)}`).join(', ')}.`,
                ...listed(
                  contracts.map((c) => {
                    const pos = contractPosition(c, c.variations);
                    return `${c.contractNo ?? 'Draft'} — ${c.title} for ${c.client.name}${c.project ? ` (${c.project.name})` : ''}: ${titleCase(c.status)}. Contract sum ${money(pos.originalValue)} ex-VAT, ${money(pos.approvedVariations)} approved variations, ${money(pos.pendingVariations)} pending, current value ${money(pos.currentValue)} (${money(pos.grossValue)} including VAT). Retention ${pos.retentionPct}% (${money(pos.retentionAmount)}). Defects liability ${pos.defectsLiabilityMonths} months${pos.defectsLiabilityEnds ? `, ending ${pos.defectsLiabilityEnds}` : ', not yet started'}.`;
                  }),
                  15,
                ),
              ].join('\n'),
        source: { label: 'Contracts', href: '/admin/contracts' },
      };
    },
  },

  // ---- Across the company --------------------------------------------------

  {
    name: 'company_operations',
    scope: 'office',
    description:
      'What needs attention across every site right now: sites over budget, payments and invoices overdue, sites with no supervisor assigned, sites gone quiet or finishing soon, approvals waiting on a decision, open defects and recent safety incidents. The same list the Overview page shows.',
    run: async () => {
      const weekAgo = new Date(today().getTime() - 7 * DAY_MS);

      // Open defects and recent safety incidents are not part of the Overview
      // digest, so they are gathered separately and appended to it — the rest
      // of this answer comes from the SAME function that page calls, so the
      // two can never disagree about what's over budget or overdue.
      const [openSnags, incidents, digest] = await Promise.all([
        prisma.snagItem.groupBy({
          by: ['severity'],
          where: { status: { in: ['OPEN', 'IN_PROGRESS', 'REJECTED'] } },
          _count: true,
        }),
        prisma.safetyIncident.count({ where: { occurredAt: { gte: weekAgo } } }),
        attentionDigest(),
      ]);

      const totalOpen = openSnags.reduce((n, s) => n + s._count, 0);
      const g = digest.groups;

      return {
        facts: [
          `Open defects across all sites: ${totalOpen}${totalOpen ? ` (${openSnags.map((s) => `${s._count} ${titleCase(s.severity)}`).join(', ')})` : ''}.`,
          `Safety incidents in the last 7 days: ${incidents}.`,
          g.overBudget.length
            ? `Over budget: ${g.overBudget.map((p) => `${p.name} (${p.consumedPct}% spent)`).join(', ')}.`
            : 'No site is over budget.',
          g.paymentOverdue.length
            ? `${plural(g.paymentOverdue.length, 'site')} with the client balance overdue, ${money(g.paymentOverdue.reduce((s, p) => s + p.pendingBalance, 0))} total. Longest overdue: ${g.paymentOverdue[0].name} (${plural(g.paymentOverdue[0].daysOverdue, 'day')}).`
            : 'No site has its client balance overdue.',
          g.invoiceOverdue.length
            ? `${plural(g.invoiceOverdue.length, 'invoice')} overdue, ${money(g.invoiceOverdue.reduce((s, i) => s + i.balance, 0))} total.`
            : 'No invoices are overdue.',
          g.unassigned.length
            ? `Active sites with no supervisor assigned: ${g.unassigned.map((p) => p.name).join(', ')}.`
            : 'Every active site has a supervisor assigned.',
          g.wentQuiet.length
            ? `Sites with no recent report: ${g.wentQuiet.map((p) => p.name).join(', ')}.`
            : 'Every active site has reported recently.',
          g.finishingSoon.length
            ? `Finishing within ${FINISHING_SOON_DAYS} days: ${g.finishingSoon.map((p) => `${p.name} (${plural(p.daysLeft, 'day')})`).join(', ')}.`
            : 'Nothing is due to finish in the next two weeks.',
          g.pendingApprovals.length
            ? `Awaiting a decision: ${g.pendingApprovals.map((p) => `${p.name} (${p.total})`).join(', ')}.`
            : 'Nothing is awaiting approval.',
        ].join('\n'),
        source: { label: 'Overview', href: '/admin' },
      };
    },
  },

  {
    name: 'equipment',
    scope: 'shared',
    description:
      'The tool and equipment register: what the company owns, where each item is right now, what is in for maintenance and what is overdue a service.',
    run: async (ctx) => {
      const office = isOffice(ctx.user.role);
      const tools = await prisma.tool.findMany({
        // A supervisor is answerable for the kit on their sites, not the whole
        // register — and tools in the central store are nobody's site.
        where: office ? {} : { currentProjectId: scopedProjectIds(ctx) },
        select: {
          name: true,
          category: true,
          unit: true,
          quantity: true,
          status: true,
          nextServiceDate: true,
          conditionNotes: true,
          currentProject: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
      });

      const asAt = today();
      const overdue = tools.filter((t) => t.nextServiceDate && t.nextServiceDate < asAt);
      const inStore = tools.filter((t) => !t.currentProject);

      return {
        facts:
          tools.length === 0
            ? office
              ? 'No tools have been registered.'
              : 'No tools are recorded at your sites.'
            : [
                `${plural(tools.length, 'item')} in the register: ${tally(tools, (t) => t.status).map(([s, n]) => `${n} ${titleCase(s)}`).join(', ')}.`,
                office ? `${inStore.length} in the central store, ${tools.length - inStore.length} out at sites.` : '',
                overdue.length
                  ? `Service overdue: ${overdue.map((t) => `${t.name} (was due ${day(t.nextServiceDate)})`).join(', ')}.`
                  : 'Nothing is overdue a service.',
                ...listed(
                  tools.map(
                    (t) =>
                      `${t.name}${t.category ? ` (${t.category})` : ''} — ${Number(t.quantity)} ${t.unit}, ${titleCase(t.status)}, at ${t.currentProject?.name ?? 'central store'}${t.nextServiceDate ? `, next service ${day(t.nextServiceDate)}` : ''}${t.conditionNotes ? `. ${t.conditionNotes}` : ''}.`,
                  ),
                  20,
                ),
              ]
                .filter(Boolean)
                .join('\n'),
        source: { label: 'Equipment', href: office ? '/admin/tools' : '/supervisor' },
      };
    },
  },

  {
    name: 'upcoming',
    scope: 'shared',
    description:
      'What is coming up: booked events like milestones, inspections, deliveries and meetings, plus dates the system works out for itself — site deadlines, equipment servicing, retention release. Takes days ahead, default 30.',
    args: ['days'],
    run: async (ctx) => {
      const office = isOffice(ctx.user.role);
      const days = Math.min(Math.max(parseInt(ctx.args.days ?? '30', 10) || 30, 1), 180);
      const from = today();
      const to = new Date(from.getTime() + days * DAY_MS);
      const projectFilter = office ? null : { id: scopedProjectIds(ctx) };

      const [booked, derived] = await Promise.all([
        prisma.calendarEvent.findMany({
          where: {
            date: { gte: from, lte: to },
            // A company-wide event (projectId null) shows on everyone's calendar.
            ...(office ? {} : { OR: [{ projectId: null }, { projectId: scopedProjectIds(ctx) }] }),
          },
          select: {
            title: true,
            type: true,
            date: true,
            notes: true,
            project: { select: { name: true } },
          },
          orderBy: { date: 'asc' },
        }),
        derivedEvents({ from, to, projectFilter, includeCompanyWide: office }),
      ]);

      const all = [
        ...booked.map((e) => ({
          date: e.date,
          line: `${day(e.date)} — ${titleCase(e.type)}: ${e.title}${e.project ? ` (${e.project.name})` : ''}${e.notes ? `. ${e.notes}` : ''}`,
        })),
        ...derived.map((e) => ({
          date: e.date,
          line: `${day(e.date)} — ${titleCase(e.type)}: ${e.title}${e.project ? ` (${e.project.name})` : ''}`,
        })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime());

      return {
        facts:
          all.length === 0
            ? `Nothing is scheduled in the next ${days} days.`
            : [
                `${plural(all.length, 'thing is', 'things are')} coming up in the next ${days} days:`,
                ...listed(all.map((e) => e.line), 30),
              ].join('\n'),
        source: { label: 'Calendar', href: office ? '/admin/calendar' : '/supervisor/calendar' },
      };
    },
  },

  // ---- Drilling into one supplier, one worker, or recent changes -----------

  {
    name: 'supplier_detail',
    scope: 'office',
    description:
      'One supplier by name: every bill raised against them, what has been paid on each, and what remains outstanding. Use for a question naming a specific supplier rather than the whole payables list.',
    args: ['name'],
    run: async ({ args }) => {
      const needle = (args.name ?? '').trim();
      if (!needle) throw new RetrievalDenied('Which supplier do you mean?');
      const matches = await prisma.supplier.findMany({
        where: { name: { contains: needle, mode: 'insensitive' } },
        select: { id: true, name: true, phone: true, active: true },
        take: 6,
      });
      if (matches.length === 0) {
        return { facts: `No supplier on file matches "${needle}".` };
      }
      if (matches.length > 1) {
        return {
          facts: `More than one supplier matches "${needle}": ${matches.map((m) => m.name).join(', ')}. Ask about one by its full name.`,
        };
      }
      const supplier = matches[0];
      const { costs, paymentsByCost } = await loadLedger({ supplierId: supplier.id });
      const [position] = supplierPositions(costs, paymentsByCost);
      const bills = await prisma.expense.findMany({
        where: { supplierId: supplier.id },
        select: {
          description: true,
          amount: true,
          expenseDate: true,
          dueDate: true,
          supplierInvoiceNo: true,
          project: { select: { name: true } },
          payments: { select: { amount: true, whtAmount: true, whtVatAmount: true } },
        },
        orderBy: { expenseDate: 'desc' },
        take: 25,
      });

      return {
        facts: [
          `${supplier.name}${supplier.active ? '' : ' (retired)'}${supplier.phone ? `, ${supplier.phone}` : ''}.`,
          position
            ? `Owed ${money(position.outstanding)} across ${plural(position.openBills, 'open bill')}${position.overdue > 0 ? `, ${money(position.overdue)} overdue by up to ${position.oldestOverdueDays} days` : ', none overdue'}.`
            : 'No bills have ever been raised against this supplier.',
          ...listed(
            bills.map((b) => {
              const paid = b.payments.reduce(
                (n, p) =>
                  n +
                  paymentSettles({
                    amount: Number(p.amount),
                    whtAmount: Number(p.whtAmount),
                    whtVatAmount: Number(p.whtVatAmount),
                  }),
                0,
              );
              const outstanding = Math.max(0, Number(b.amount) - paid);
              return `${money(Number(b.amount))} — ${b.description} (${b.project.name})${b.supplierInvoiceNo ? `, invoice ${b.supplierInvoiceNo}` : ''}, ${day(b.expenseDate)}: ${outstanding > 0 ? `${money(outstanding)} outstanding` : 'settled'}.`;
            }),
            10,
          ),
        ].join('\n'),
        source: { label: `${supplier.name} — payables`, href: '/admin/suppliers' },
      };
    },
  },

  {
    name: 'worker_detail',
    scope: 'office',
    description:
      'One worker by name: their trade, current site assignment, what they are owed from attendance, and their recent payment history. Use for a question naming a specific worker rather than the whole staff list.',
    args: ['name'],
    run: async ({ args }) => {
      const needle = (args.name ?? '').trim();
      if (!needle) throw new RetrievalDenied('Which worker do you mean?');
      const matches = await prisma.worker.findMany({
        where: { name: { contains: needle, mode: 'insensitive' } },
        select: {
          id: true,
          name: true,
          trade: true,
          status: true,
          assignments: { where: { endDate: null }, select: { project: { select: { name: true } } } },
        },
        take: 6,
      });
      if (matches.length === 0) {
        return { facts: `No worker on file matches "${needle}".` };
      }
      if (matches.length > 1) {
        return {
          facts: `More than one worker matches "${needle}": ${matches.map((m) => m.name).join(', ')}. Ask about one by their full name.`,
        };
      }
      const worker = matches[0];
      const [accrued, payments] = await Promise.all([
        accruedByWorker([worker.id]),
        prisma.workerPayment.findMany({
          where: { workerId: worker.id },
          select: { amount: true, whtAmount: true, method: true, paymentDate: true },
          orderBy: { paymentDate: 'desc' },
          take: 10,
        }),
      ]);
      const paymentRecords: WorkerPaymentRecord[] = payments.map((p) => ({
        amount: Number(p.amount),
        whtAmount: Number(p.whtAmount),
      }));
      const position = workerPosition(accrued.get(worker.id) ?? 0, paymentRecords);

      return {
        facts: [
          `${worker.name} — ${worker.trade}, ${worker.status === 'ACTIVE' ? 'active' : 'inactive'}.`,
          worker.assignments.length
            ? `Assigned to: ${worker.assignments.map((a) => a.project.name).join(', ')}.`
            : 'Not currently assigned to a site.',
          `Owed ${money(position.outstanding)} from attendance; ${money(position.cashPaid)} paid in cash and ${money(position.taxWithheld)} withheld for tax so far.`,
          payments.length
            ? `Recent payments: ${payments.map((p) => `${money(Number(p.amount))} by ${titleCase(p.method)} on ${day(p.paymentDate)}`).join('; ')}.`
            : 'No payment has ever been recorded for this worker.',
        ].join('\n'),
        source: { label: `${worker.name} — worker`, href: '/admin/workers' },
      };
    },
  },

  {
    name: 'recent_activity',
    scope: 'office',
    description:
      'What has changed in the system recently — a running log of who created, approved, rejected or edited what. Use for "what changed", "what happened this week", or auditing a specific kind of action.',
    args: ['days'],
    run: async ({ args }) => {
      const days = Math.min(Math.max(parseInt(args.days ?? '7', 10) || 7, 1), 30);
      const since = new Date(today().getTime() - days * DAY_MS);
      const entries = await prisma.auditLog.findMany({
        where: { createdAt: { gte: since } },
        select: { action: true, entity: true, createdAt: true, user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 60,
      });
      const byAction = tally(entries, (e) => e.action);
      return {
        facts:
          entries.length === 0
            ? `Nothing was recorded in the system in the last ${plural(days, 'day')}.`
            : [
                `${plural(entries.length, 'action')} recorded in the last ${plural(days, 'day')}.`,
                `Most common: ${byAction.slice(0, 8).map(([a, n]) => `${a} (${n})`).join(', ')}.`,
                ...listed(
                  entries.map(
                    (e) =>
                      `${day(e.createdAt)} — ${e.user?.name ?? 'system'}: ${e.action} (${e.entity}).`,
                  ),
                  25,
                ),
              ].join('\n'),
        source: { label: 'Audit log', href: '/admin/settings?tab=audit' },
      };
    },
  },

  {
    name: 'site_ranking',
    scope: 'shared',
    description:
      'Ranks sites against each other by one measure — open defects, budget consumed, or overdue client balance. Use for "which site has the most/worst X" rather than a single-site question.',
    args: ['metric'],
    run: async (ctx) => {
      const office = isOffice(ctx.user.role);
      const metric = (ctx.args.metric ?? 'defects').toLowerCase();
      const scope = withinScope(ctx);

      if (metric === 'budget' || metric === 'overdue') {
        if (!office) throw new RetrievalDenied('That ranking is office-only.');
      }

      if (metric === 'budget') {
        const projects = await prisma.project.findMany({ where: scope, select: { id: true, name: true } });
        // Read the finance settings once and hand them down. Without this,
        // every site in the ranking re-read the same two Setting rows before
        // doing its own four queries — six per site, for two values that are
        // the same on all of them.
        const settings = await getFinanceSettings();
        const rows = (
          await Promise.all(
            projects.map(async (p) => ({
              name: p.name,
              fin: await projectFinancials(p.id, settings),
            })),
          )
        )
          .filter((r) => r.fin.overallConsumedPct != null)
          .sort((a, b) => (b.fin.overallConsumedPct ?? 0) - (a.fin.overallConsumedPct ?? 0));
        return {
          facts: rows.length
            ? `Sites by budget consumed, highest first:\n${listed(rows.map((r) => `${r.name}: ${r.fin.overallConsumedPct}% (${r.fin.overallHealth.toLowerCase()}).`), 20).join('\n')}`
            : 'No site has a budget set yet.',
          source: { label: 'Budgets', href: '/admin' },
        };
      }

      if (metric === 'overdue') {
        const digest = await attentionDigest();
        return {
          facts: digest.groups.paymentOverdue.length
            ? `Sites by days overdue, worst first:\n${digest.groups.paymentOverdue
                .sort((a, b) => b.daysOverdue - a.daysOverdue)
                .map((p) => `${p.name}: ${money(p.pendingBalance)}, ${plural(p.daysOverdue, 'day')} overdue.`)
                .join('\n')}`
            : 'No site has an overdue client balance.',
          source: { label: 'Overview', href: '/admin' },
        };
      }

      // Default: open defects.
      const grouped = (
        await prisma.snagItem.groupBy({
          by: ['projectId'],
          where: { status: { in: ['OPEN', 'IN_PROGRESS', 'REJECTED'] }, project: scope },
          _count: true,
        })
      ).sort((a, b) => b._count - a._count);
      const names = new Map(
        (
          await prisma.project.findMany({
            where: { id: { in: grouped.map((g) => g.projectId) } },
            select: { id: true, name: true },
          })
        ).map((p) => [p.id, p.name]),
      );
      return {
        facts: grouped.length
          ? `Sites by open defects, most first:\n${grouped.map((g) => `${names.get(g.projectId) ?? 'Unknown'}: ${g._count}.`).join('\n')}`
          : 'No site has an open defect right now.',
        source: { label: 'Defects', href: office ? '/admin' : '/supervisor' },
      };
    },
  },

  {
    name: 'reporting_compliance',
    scope: 'office',
    description:
      'Which sites have gone quiet — no daily report filed recently — across the whole portfolio. Use for "who is behind on reports" or "which sites have not reported".',
    run: async () => {
      const digest = await attentionDigest();
      return {
        facts: digest.groups.wentQuiet.length
          ? [
              `${plural(digest.groups.wentQuiet.length, 'active site has', 'active sites have')} gone quiet:`,
              ...digest.groups.wentQuiet.map(
                (p) =>
                  `${p.name}: ${p.lastReportAt ? `last reported ${day(p.lastReportAt)}, ${plural(p.daysSince ?? 0, 'day')} ago` : 'has never filed a report'}.`,
              ),
            ].join('\n')
          : 'Every active site has reported recently.',
        source: { label: 'Overview', href: '/admin' },
      };
    },
  },

  {
    name: 'spend_trend',
    scope: 'office',
    description:
      'How spend has moved month by month, by category (materials, labour, transport, other) — for one site if projectId is given, company-wide otherwise. Use for "is spend going up", "trend", or a month-by-month breakdown.',
    args: ['projectId'],
    run: async ({ args }) => {
      const settings = await getFinanceSettings();
      const projectId = args.projectId;
      const rows = toSeries(await monthlyTotals(settings.labourCostSource, projectId ? [projectId] : undefined));
      const label = projectId
        ? (await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } })).name
        : 'the whole company';
      if (rows.length === 0) {
        return {
          facts: `No spend has been recorded yet for ${label}.`,
          source: { label: 'Spend trend', href: projectId ? `/admin/projects/${projectId}` : '/admin' },
        };
      }
      const recent = rows.slice(-6);
      const trendNote =
        recent.length >= 2
          ? recent[recent.length - 1].total > recent[recent.length - 2].total
            ? 'Spend rose last month compared to the month before.'
            : recent[recent.length - 1].total < recent[recent.length - 2].total
              ? 'Spend fell last month compared to the month before.'
              : 'Spend held flat last month compared to the month before.'
          : '';
      return {
        facts: [
          `Monthly spend for ${label} (last ${plural(recent.length, 'month')}):`,
          ...recent.map(
            (r) =>
              `${r.month}: ${money(r.total)} total (Materials ${money(r.MATERIALS)}, Labour ${money(r.LABOUR)}, Transport ${money(r.TRANSPORT)}, Other ${money(r.OTHER)}).`,
          ),
          `Cumulative to date: ${money(rows[rows.length - 1].cumulative)}.`,
          trendNote,
        ]
          .filter(Boolean)
          .join('\n'),
        source: { label: 'Spend trend', href: projectId ? `/admin/projects/${projectId}?tab=financials` : '/admin' },
      };
    },
  },

  {
    name: 'budget_impact',
    scope: 'office',
    description:
      'What is still PENDING against one site — expenses awaiting approval and material requests awaiting a decision or delivery — set against what budget remains, so the effect of approving everything in the queue can be seen before it happens. Needs projectId.',
    args: ['projectId'],
    run: async ({ args }) => {
      const projectId = args.projectId;
      if (!projectId) throw new RetrievalDenied('Which site do you mean?');
      const [project, fin, pendingExpenses, openRequests] = await Promise.all([
        prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } }),
        projectFinancials(projectId),
        prisma.expense.findMany({
          where: { projectId, status: 'PENDING' },
          select: { amount: true },
        }),
        prisma.materialRequest.findMany({
          where: { projectId, status: { in: ['PENDING', 'APPROVED'] } },
          select: { quantity: true, unit: true, itemName: true },
        }),
      ]);
      const pendingTotal = pendingExpenses.reduce((n, e) => n + Number(e.amount), 0);
      const projectedActual = fin.totalActual + pendingTotal;
      const projectedRemaining = fin.totalBudget - projectedActual;
      const projectedPct = fin.totalBudget > 0 ? Math.round((projectedActual / fin.totalBudget) * 100) : null;

      return {
        facts: [
          `${project.name}: budget ${money(fin.totalBudget)}, actual so far ${money(fin.totalActual)}, remaining ${money(fin.totalRemaining)}${fin.overallConsumedPct != null ? ` (${fin.overallConsumedPct}% consumed)` : ''}.`,
          pendingExpenses.length
            ? `${plural(pendingExpenses.length, 'expense')} awaiting approval, worth ${money(pendingTotal)}. If all were approved: actual would become ${money(projectedActual)}, remaining ${money(projectedRemaining)}${projectedPct != null ? ` (${projectedPct}% consumed)` : ''}.`
            : 'No expenses are awaiting approval on this site.',
          openRequests.length
            ? `Material requests still open (not yet reflected in spend): ${openRequests.map((r) => `${Number(r.quantity)} ${r.unit} ${r.itemName}`).join(', ')}.`
            : 'No material requests are outstanding on this site.',
        ].join('\n'),
        source: { label: `${project.name} — budget impact`, href: `/admin/projects/${projectId}?tab=financials` },
      };
    },
  },
];

export const LOOKUP_BY_NAME = new Map(LOOKUPS.map((l) => [l.name, l]));

/** Lookups this user is allowed to use at all. */
export function lookupsFor(user: ChatUser): Lookup[] {
  return LOOKUPS.filter((l) => l.scope !== 'office' || isOffice(user.role));
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

  if (lookup.scope === 'office' && !isOffice(user.role)) {
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

  return lookup.run({ user, projectId, args, allowedProjectIds });
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
