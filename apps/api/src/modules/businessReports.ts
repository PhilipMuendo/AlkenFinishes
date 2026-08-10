import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, ApiError } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess, requireSuperadmin } from '../middleware/rbac';
import { audit } from '../middleware/audit';
import { signFileUrl } from '../middleware/upload';
import { getCompanyProfile } from '../services/invoicing';
import { projectFinancials } from '../services/finance';
import {
  projectReceivables,
  paymentSettledCents,
  LIVE_INVOICE_STATUSES,
} from '../services/invoicing';
import { printDate as fmtDate } from '../services/pdf';
import { renderReportPdf, type ReportSection, type SummaryLine } from '../services/documents/reportPdf';

/**
 * The report pack: eight printable views over data that already lives
 * elsewhere in the system (financials, receivables, expenses, attendance,
 * variations, the site diary). Nothing here computes a new number — each
 * report reassembles figures from the same services the live pages use, so a
 * report and the screen it summarises can never quietly disagree.
 */
const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess, requireSuperadmin);

const REPORT_TYPES = [
  'financial-summary',
  'progress',
  'attendance',
  'expenses',
  'client-statement',
  'receivables',
  'variations',
  'site-diary',
] as const;
type ReportType = (typeof REPORT_TYPES)[number];

const rangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.get(
  '/:type',
  asyncHandler(async (req, res) => {
    const type = req.params.type as ReportType;
    if (!REPORT_TYPES.includes(type)) throw ApiError.notFound('Unknown report type');
    const { from, to } = rangeSchema.parse(req.query);
    const projectId = req.params.projectId;

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { name: true, clientName: true, code: true },
    });
    const company = await getCompanyProfile();
    const rangeLabel =
      from && to
        ? `${fmtDate(from)} – ${fmtDate(to)}`
        : from
          ? `From ${fmtDate(from)}`
          : to
            ? `Up to ${fmtDate(to)}`
            : 'All time';
    const generatedFor = `${project.name}${project.code ? ` (${project.code})` : ''} · ${rangeLabel}`;

    const { title, subtitle, sections, summary } = await buildReport(
      type,
      projectId,
      project,
      from,
      to,
    );

    const url = await renderReportPdf({
      title,
      subtitle,
      company,
      generatedFor,
      sections,
      summary,
    });

    audit(req, 'report.generate', 'Project', projectId, { type });
    res.json({ url: signFileUrl(url) });
  }),
);

async function buildReport(
  type: ReportType,
  projectId: string,
  project: { name: string; clientName: string },
  from?: Date,
  to?: Date,
): Promise<{ title: string; subtitle: string; sections: ReportSection[]; summary?: SummaryLine[] }> {
  const dateWhere = { ...(from && { gte: from }), ...(to && { lte: to }) };

  switch (type) {
    case 'financial-summary': {
      const fin = await projectFinancials(projectId);
      return {
        title: 'Financial Summary',
        subtitle: 'Budget allocated versus actual spend, by category',
        sections: [
          {
            columns: [
              { header: 'Category' },
              { header: 'Allocated', align: 'right' },
              { header: 'Actual', align: 'right' },
              { header: 'Remaining', align: 'right' },
              { header: 'Consumed', align: 'right' },
            ],
            moneyColumns: [1, 2, 3],
            rows: fin.categories.map((c) => [
              c.category,
              c.allocated,
              c.actual,
              c.remaining,
              c.consumedPct != null ? `${c.consumedPct}%` : '—',
            ]),
          },
        ],
        summary: [
          { label: 'Contract value', value: `KES ${fin.contractValue.toLocaleString()}` },
          { label: 'Total budget', value: `KES ${fin.totalBudget.toLocaleString()}` },
          { label: 'Total actual', value: `KES ${fin.totalActual.toLocaleString()}` },
          {
            label: 'Estimated profit',
            value: `KES ${fin.estimatedProfit.toLocaleString()}`,
            emphasis: true,
          },
        ],
      };
    }

    case 'progress': {
      const [tasksByPhase, latest] = await Promise.all([
        prisma.task.findMany({
          where: { projectId },
          orderBy: [{ phase: 'asc' }, { sortOrder: 'asc' }],
        }),
        prisma.dailyReport.findFirst({ where: { projectId }, orderBy: { date: 'desc' } }),
      ]);
      const phases = [...new Set(tasksByPhase.map((t) => t.phase))];
      return {
        title: 'Progress Report',
        subtitle: 'Task completion by phase',
        sections: [
          {
            columns: [
              { header: 'Phase' },
              { header: 'Task' },
              { header: 'Status' },
              { header: '% complete', align: 'right' },
            ],
            rows: tasksByPhase.map((t) => [t.phase, t.name, t.status.replace('_', ' '), t.completionPct]),
          },
        ],
        summary: [
          { label: 'Phases tracked', value: String(phases.length) },
          { label: 'Total tasks', value: String(tasksByPhase.length) },
          {
            label: 'Latest site update',
            value: latest ? fmtDate(latest.date) : 'None submitted',
            emphasis: true,
          },
        ],
      };
    }

    case 'attendance': {
      const records = await prisma.attendanceRecord.findMany({
        where: { projectId, date: dateWhere },
        include: { worker: { select: { name: true, trade: true } } },
        orderBy: { date: 'asc' },
      });
      const totalHours = records.reduce((s, r) => s + Number(r.hoursWorked ?? 0), 0);
      const totalCost = records.reduce((s, r) => s + Number(r.labourCost ?? 0), 0);
      const overtimeHours = records.reduce((s, r) => s + Math.max(0, Number(r.hoursWorked ?? 0) - 8), 0);
      return {
        title: 'Attendance & Labour Report',
        subtitle: 'Hours and labour cost by worker',
        sections: [
          {
            columns: [
              { header: 'Date' },
              { header: 'Worker' },
              { header: 'Trade' },
              { header: 'Hours', align: 'right' },
              { header: 'Cost', align: 'right' },
            ],
            moneyColumns: [4],
            rows: records.map((r) => [
              fmtDate(r.date),
              r.worker.name,
              r.worker.trade,
              r.hoursWorked != null ? Number(r.hoursWorked) : '—',
              Number(r.labourCost ?? 0),
            ]),
          },
        ],
        summary: [
          { label: 'Total hours', value: totalHours.toFixed(1) },
          { label: 'Of which overtime', value: `${overtimeHours.toFixed(1)} h` },
          { label: 'Total labour cost', value: `KES ${totalCost.toLocaleString()}`, emphasis: true },
        ],
      };
    }

    case 'expenses': {
      const expenses = await prisma.expense.findMany({
        where: { projectId, expenseDate: dateWhere },
        include: { submittedBy: { select: { name: true } } },
        orderBy: { expenseDate: 'asc' },
      });
      const total = expenses.filter((e) => e.status === 'APPROVED').reduce((s, e) => s + Number(e.amount), 0);
      return {
        title: 'Expense Report',
        subtitle: 'Claims by category and status',
        sections: [
          {
            columns: [
              { header: 'Date' },
              { header: 'Category' },
              { header: 'Description' },
              { header: 'By' },
              { header: 'Status' },
              { header: 'Amount', align: 'right' },
            ],
            moneyColumns: [5],
            rows: expenses.map((e) => [
              fmtDate(e.expenseDate),
              e.expenseCategory.replace('_', ' '),
              e.description,
              e.submittedBy.name,
              e.status,
              Number(e.amount),
            ]),
          },
        ],
        summary: [
          { label: 'Claims', value: String(expenses.length) },
          {
            label: 'Approved spend',
            value: `KES ${total.toLocaleString()}`,
            emphasis: true,
          },
        ],
      };
    }

    case 'client-statement': {
      const [invoices, payments] = await Promise.all([
        prisma.invoice.findMany({
          // LIVE only. `not: 'DRAFT'` also let VOID invoices through, and a
          // voided invoice billed the client nothing — carrying it as a debit
          // overstated the balance on a document that goes to them.
          where: { projectId, status: { in: LIVE_INVOICE_STATUSES } },
          orderBy: { issueDate: 'asc' },
        }),
        prisma.payment.findMany({
          where: { projectId, voidedAt: null },
          orderBy: { paymentDate: 'asc' },
        }),
      ]);
      type StatementLine = { date: Date; desc: string; debit: number; credit: number };
      const lines: StatementLine[] = [
        ...invoices.map((i) => ({
          date: i.issueDate,
          desc: `Invoice ${i.invoiceNo}`,
          debit: Number(i.netPayable),
          credit: 0,
        })),
        ...payments.map((p) => {
          // Tax the client withheld settles the invoice exactly as cash does —
          // they paid it to KRA on our behalf. Crediting only the cash chased
          // the client for money they had already surrendered, which is the
          // one thing a statement must never do.
          const withheld = Number(p.whtAmount) + Number(p.whtVatAmount);
          const label = p.receiptNo ? `Receipt ${p.receiptNo}` : `Payment (${p.method})`;
          return {
            date: p.paymentDate,
            desc:
              withheld > 0
                ? `${label} (incl. KES ${withheld.toLocaleString()} withheld for KRA)`
                : label,
            debit: 0,
            credit: paymentSettledCents(p) / 100,
          };
        }),
      ].sort((a, b) => a.date.getTime() - b.date.getTime());
      let running = 0;
      const rows = lines.map((l) => {
        running += l.debit - l.credit;
        return [fmtDate(l.date), l.desc, l.debit || '', l.credit || '', running];
      });
      return {
        title: 'Client Statement',
        subtitle: `Statement of account for ${project.clientName}`,
        sections: [
          {
            columns: [
              { header: 'Date' },
              { header: 'Description' },
              { header: 'Billed', align: 'right' },
              { header: 'Received', align: 'right' },
              { header: 'Balance', align: 'right' },
            ],
            moneyColumns: [2, 3, 4],
            rows,
          },
        ],
        summary: [
          { label: 'Balance outstanding', value: `KES ${running.toLocaleString()}`, emphasis: true },
        ],
      };
    }

    case 'receivables': {
      const rec = await projectReceivables(projectId);
      return {
        title: 'Retention & Receivables',
        subtitle: 'Position on invoiced amounts, retention and ageing',
        sections: [
          {
            columns: [{ header: 'Status' }, { header: 'Count', align: 'right' }],
            rows: [
              ['Draft', rec.counts.draft],
              ['Issued', rec.counts.issued],
              ['Partially paid', rec.counts.partiallyPaid],
              ['Paid', rec.counts.paid],
              ['Overdue', rec.counts.overdue],
            ],
          },
        ],
        summary: [
          { label: 'Invoiced (net)', value: `KES ${rec.invoicedNet.toLocaleString()}` },
          { label: 'Retention held', value: `KES ${rec.retentionHeld.toLocaleString()}` },
          { label: 'Outstanding', value: `KES ${rec.arOutstanding.toLocaleString()}` },
          { label: 'Overdue', value: `KES ${rec.arOverdue.toLocaleString()}`, emphasis: true },
        ],
      };
    }

    case 'variations': {
      const contract = await prisma.contract.findUnique({
        where: { projectId },
        include: { variations: { orderBy: { reference: 'asc' } } },
      });
      const variations = contract?.variations ?? [];
      const approved = variations.filter((v) => v.status === 'APPROVED');
      const netChange = approved.reduce((s, v) => s + Number(v.amount), 0);
      return {
        title: 'Variation Orders',
        subtitle: contract?.contractNo ? `Contract ${contract.contractNo}` : 'No contract on file',
        sections: [
          {
            columns: [
              { header: 'Ref' },
              { header: 'Description' },
              { header: 'Requested' },
              { header: 'Status' },
              { header: 'Amount', align: 'right' },
            ],
            moneyColumns: [4],
            rows: variations.map((v) => [
              v.reference,
              v.description,
              fmtDate(v.requestedDate),
              v.status,
              Number(v.amount),
            ]),
          },
        ],
        summary: contract
          ? [
              { label: 'Original contract sum', value: `KES ${Number(contract.originalValue).toLocaleString()}` },
              { label: 'Net approved variations', value: `KES ${netChange.toLocaleString()}` },
              {
                label: 'Current contract sum',
                value: `KES ${(Number(contract.originalValue) + netChange).toLocaleString()}`,
                emphasis: true,
              },
            ]
          : undefined,
      };
    }

    case 'site-diary': {
      const reports = await prisma.dailyReport.findMany({
        where: { projectId, date: dateWhere },
        include: { submittedBy: { select: { name: true } } },
        orderBy: { date: 'asc' },
      });
      return {
        title: 'Site Diary Digest',
        subtitle: 'Daily reports for the period',
        sections: [
          {
            columns: [
              { header: 'Date' },
              { header: 'Workers' },
              { header: 'Work completed' },
              { header: 'Challenges' },
              { header: 'By' },
            ],
            rows: reports.map((r) => [
              fmtDate(r.date),
              r.workersPresent,
              r.workCompleted,
              r.challenges ?? '—',
              r.submittedBy.name,
            ]),
          },
        ],
      };
    }
  }
}

export default router;
