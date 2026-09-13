import { prisma } from '../lib/prisma';
import { LIVE_INVOICE_STATUSES, projectReceivables } from './invoicing';

/**
 * Project Close-out — the final gate. Five of its thirteen items are
 * computed fresh every time this is read (never stored), the same
 * "autogenerate" reasoning as HandoverChecklist's auto items; the other
 * eight are ticked by hand. A project is only actually closed once every
 * one of the thirteen is checked.
 */
export const MANUAL_CLOSEOUT_ITEMS = [
  'Work completed',
  'Equipment returned',
  'Materials reconciled',
  'Project P&L completed',
  'Lessons learned recorded',
  'Photos archived',
  'Testimonial requested',
  'Referral requested',
] as const;

// The single source of truth for which labels are computed rather than
// ticked by hand — modules/projectCloseout.ts tags each item with this when
// serialising a response, instead of the frontend guessing by label text.
export const AUTO_CLOSEOUT_ITEMS = [
  'Quality approved',
  'Snags closed',
  'Site handed over',
  'Final invoice issued',
  'Payments reconciled',
] as const;

export interface CloseoutItem {
  label: string;
  checked: boolean;
}

export async function ensureProjectCloseout(projectId: string, userId: string) {
  const existing = await prisma.projectCloseout.findUnique({ where: { projectId } });
  if (existing) return existing;
  return prisma.projectCloseout.create({
    data: {
      projectId,
      items: MANUAL_CLOSEOUT_ITEMS.map((label) => ({ label, checked: false })),
      createdById: userId,
    },
  });
}

async function autoItems(projectId: string): Promise<CloseoutItem[]> {
  const [inspectionCounts, openSnags, handover, invoices, receivables] = await Promise.all([
    prisma.qualityInspection.groupBy({ by: ['overallStatus'], where: { projectId }, _count: true }),
    prisma.snagItem.count({ where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS', 'RESOLVED'] } } }),
    prisma.handoverChecklist.findUnique({ where: { projectId }, select: { companySignedAt: true } }),
    prisma.invoice.count({ where: { projectId, status: { in: LIVE_INVOICE_STATUSES } } }),
    projectReceivables(projectId),
  ]);
  const total = inspectionCounts.reduce((s, r) => s + r._count, 0);
  const notPassed = inspectionCounts.filter((r) => r.overallStatus !== 'PASS').reduce((s, r) => s + r._count, 0);

  return [
    { label: AUTO_CLOSEOUT_ITEMS[0], checked: total > 0 && notPassed === 0 },
    { label: AUTO_CLOSEOUT_ITEMS[1], checked: openSnags === 0 },
    { label: AUTO_CLOSEOUT_ITEMS[2], checked: !!handover?.companySignedAt },
    { label: AUTO_CLOSEOUT_ITEMS[3], checked: invoices > 0 },
    { label: AUTO_CLOSEOUT_ITEMS[4], checked: invoices > 0 && receivables.arOutstanding === 0 },
  ];
}

/** The full thirteen-item checklist, auto items first, then the manual eight — in the client's own order. */
export async function mergedCloseoutItems(
  projectId: string,
  manual: CloseoutItem[],
): Promise<CloseoutItem[]> {
  const [quality, snags, handedOver, invoiced, reconciled] = await autoItems(projectId);
  const byLabel = new Map(manual.map((i) => [i.label, i]));
  const workCompleted = byLabel.get('Work completed')!;
  const rest = manual.filter((i) => i.label !== 'Work completed');
  return [workCompleted, quality, snags, handedOver, invoiced, reconciled, ...rest];
}

export class CloseoutIncompleteError extends Error {
  constructor(public outstanding: string[]) {
    super(`${outstanding.length} item${outstanding.length === 1 ? '' : 's'} still outstanding: ${outstanding.join(', ')}`);
  }
}

/** Refuses to close while anything is unchecked — the whole point of a close-out gate. */
export async function closeProject(projectId: string, userId: string) {
  const record = await ensureProjectCloseout(projectId, userId);
  if (record.closedAt) return record;

  const items = await mergedCloseoutItems(projectId, record.items as unknown as CloseoutItem[]);
  const outstanding = items.filter((i) => !i.checked).map((i) => i.label);
  if (outstanding.length > 0) throw new CloseoutIncompleteError(outstanding);

  const [closed] = await prisma.$transaction([
    prisma.projectCloseout.update({
      where: { id: record.id },
      data: { closedAt: new Date(), closedById: userId },
    }),
    prisma.project.update({ where: { id: projectId }, data: { status: 'COMPLETED' } }),
  ]);
  return closed;
}
