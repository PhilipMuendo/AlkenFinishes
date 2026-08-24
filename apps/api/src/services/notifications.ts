import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { attentionDigest } from './attention';
import type { NotificationType } from '@prisma/client';

const money = (n: number) =>
  `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/**
 * The in-app notification bell's write side. Two shapes of trigger:
 *
 * - An actual event (a punch that couldn't be placed) calls upsertNotification()
 *   directly, at the moment it happens — see recordIssue() in attendanceIngest.ts.
 * - A rolling condition (a site over budget, an invoice gone overdue, a
 *   contract still awaiting signature) has no single write to hook, so
 *   runNotificationScan() re-derives the current set on a timer and reopens
 *   or resolves notifications by diffing against what's already open. It
 *   reuses attentionDigest() rather than re-deriving those numbers, so the
 *   bell can never disagree with the Overview page about what's flagged.
 */

/** Opens a new notification, or reopens/refreshes an existing one with the same dedupeKey. */
export async function upsertNotification(input: {
  type: NotificationType;
  dedupeKey: string;
  title: string;
  body: string;
  projectId?: string | null;
}) {
  await prisma.notification.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: {
      type: input.type,
      dedupeKey: input.dedupeKey,
      title: input.title,
      body: input.body,
      projectId: input.projectId ?? null,
    },
    update: {
      title: input.title,
      body: input.body,
      occurrences: { increment: 1 },
      lastSeenAt: new Date(),
      resolvedAt: null, // reopens one that had cleared and come back
    },
  });
}

/** Resolves every open notification of `type` whose dedupeKey isn't in the current set — the condition has cleared. */
async function resolveGoneKeys(type: NotificationType, stillOpenKeys: string[]) {
  await prisma.notification.updateMany({
    where: { type, resolvedAt: null, dedupeKey: { notIn: stillOpenKeys } },
    data: { resolvedAt: new Date() },
  });
}

/** Marks one notification resolved directly — used when the underlying record (e.g. a sync issue) is resolved by hand. */
export async function resolveNotification(dedupeKey: string) {
  await prisma.notification.updateMany({
    where: { dedupeKey, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}

/**
 * Re-derives budget, payment/invoice and contract-signature notifications
 * from current state and reconciles them: new problems open, persisting ones
 * refresh their numbers, cleared ones resolve. Safe to call as often as
 * wanted — it's a full reconciliation, not an append.
 */
export async function runNotificationScan() {
  const digest = await attentionDigest();

  const budgetKeys: string[] = [];
  for (const p of digest.groups.overBudget) {
    const key = `budget:${p.id}`;
    budgetKeys.push(key);
    await upsertNotification({
      type: 'BUDGET_OVER_THRESHOLD',
      dedupeKey: key,
      projectId: p.id,
      title: `${p.name} is over budget`,
      body: `Spend has reached ${p.consumedPct ?? '?'}% of the allocated budget.`,
    });
  }
  await resolveGoneKeys('BUDGET_OVER_THRESHOLD', budgetKeys);

  const invoiceKeys: string[] = [];
  for (const inv of digest.groups.invoiceOverdue) {
    const key = `invoice_overdue:${inv.id}`;
    invoiceKeys.push(key);
    await upsertNotification({
      type: 'INVOICE_OVERDUE',
      dedupeKey: key,
      projectId: inv.projectId,
      title: `Invoice ${inv.invoiceNo ?? ''} overdue — ${inv.clientName}`.trim(),
      body: `${money(inv.balance)} outstanding, ${inv.daysOverdue} day${inv.daysOverdue === 1 ? '' : 's'} past due.`,
    });
  }
  await resolveGoneKeys('INVOICE_OVERDUE', invoiceKeys);

  const paymentKeys: string[] = [];
  for (const p of digest.groups.paymentOverdue) {
    const key = `payment_overdue:${p.id}`;
    paymentKeys.push(key);
    await upsertNotification({
      type: 'PAYMENT_OVERDUE',
      dedupeKey: key,
      projectId: p.id,
      title: `${p.name}'s balance is past its due date`,
      body: `${money(p.pendingBalance)} pending, ${p.daysOverdue} day${p.daysOverdue === 1 ? '' : 's'} past the agreed date.`,
    });
  }
  await resolveGoneKeys('PAYMENT_OVERDUE', paymentKeys);

  // Contracts issued to a client but not yet signed — always office-only:
  // a contract only gains a projectId (and therefore a supervisor) once it
  // converts to a site, which hasn't happened yet at this stage.
  const awaitingSignature = await prisma.contract.findMany({
    where: { status: 'ISSUED' },
    select: { id: true, title: true, originalValue: true, client: { select: { name: true } } },
  });
  const contractKeys: string[] = [];
  for (const c of awaitingSignature) {
    const key = `contract_awaiting_signature:${c.id}`;
    contractKeys.push(key);
    await upsertNotification({
      type: 'CONTRACT_AWAITING_SIGNATURE',
      dedupeKey: key,
      projectId: null,
      title: `${c.title} is awaiting signature`,
      body: `${c.client.name} — ${money(Number(c.originalValue))}, issued and not yet signed.`,
    });
  }
  await resolveGoneKeys('CONTRACT_AWAITING_SIGNATURE', contractKeys);

  logger.info(
    {
      budget: budgetKeys.length,
      invoiceOverdue: invoiceKeys.length,
      paymentOverdue: paymentKeys.length,
      contractsAwaitingSignature: contractKeys.length,
    },
    'notification scan complete',
  );
}
