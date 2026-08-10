import { prisma } from '../lib/prisma';

/**
 * How much of the day's free allowance has been spent, and who may spend more.
 *
 * The three AI features share one key and therefore one daily cap. Left alone
 * they would compete: chat is by far the hungriest — a single conversation can
 * be a dozen calls where a receipt is one — so on a normal Tuesday the chat
 * would quietly eat the allowance and the receipt reader would be dead by
 * mid-morning, with nothing to explain why.
 *
 * So chat yields. Receipts and reports may spend the whole budget; chat stops
 * at the point where the rest of the day's receipts would be at risk, and says
 * so. The work the business depends on wins over the convenience.
 *
 * The count is kept in one Setting row rather than a table: it is a handful of
 * writes a day, and it costs no migration. It is a guard rail, not an
 * accounting record — the provider's own count is authoritative, and a
 * `QUOTA_DAILY` rejection from upstream is still handled wherever it lands.
 */

export type AiFeature = 'chat' | 'receipt' | 'report';

const KEY = 'aiUsage';
const BUDGET_KEY = 'aiBudget';

export interface AiBudget {
  /** Calls a day the key is assumed to allow. */
  dailyCalls: number;
  /**
   * Calls held back from chat, for the features that are actually load-bearing.
   * Chat stops once fewer than this many remain.
   */
  reservedForWork: number;
}

// Google's free Flash tier has sat around 200 requests a day. The reserve is
// sized for a busy day of receipts and one diary per site, which is the volume
// the business would actually miss.
export const DEFAULT_AI_BUDGET: AiBudget = { dailyCalls: 200, reservedForWork: 60 };

export async function getAiBudget(): Promise<AiBudget> {
  const row = await prisma.setting.findUnique({ where: { key: BUDGET_KEY } });
  const v = (row?.value ?? {}) as Partial<AiBudget>;
  return {
    dailyCalls:
      typeof v.dailyCalls === 'number' && v.dailyCalls > 0
        ? v.dailyCalls
        : DEFAULT_AI_BUDGET.dailyCalls,
    reservedForWork:
      typeof v.reservedForWork === 'number' && v.reservedForWork >= 0
        ? v.reservedForWork
        : DEFAULT_AI_BUDGET.reservedForWork,
  };
}

export interface UsageRow {
  /** YYYY-MM-DD. */
  day: string;
  chat: number;
  receipt: number;
  report: number;
  /** Prisma's Json input wants an index signature; this row is a plain object. */
  [k: string]: string | number;
}

const emptyUsage = (day: string): UsageRow => ({ day, chat: 0, receipt: 0, report: 0 });

/**
 * The day the allowance belongs to.
 *
 * Google resets on Pacific time, not UTC or Nairobi. Using the wrong midnight
 * would either free the budget early — and hit a real upstream rejection the
 * user was told would not come — or hold it back for hours after it had
 * actually reset. Neither is fatal, but the first is the one that makes the
 * message a lie, so the provider's own day is what is tracked.
 */
export function quotaDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export async function readUsage(now: Date = new Date()): Promise<UsageRow> {
  const day = quotaDay(now);
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const v = (row?.value ?? {}) as Partial<UsageRow>;
  // A stored count from an earlier day is spent budget that has since been
  // returned, so it reads as zero rather than being carried forward.
  if (v.day !== day) return emptyUsage(day);
  return {
    day,
    chat: Number(v.chat ?? 0),
    receipt: Number(v.receipt ?? 0),
    report: Number(v.report ?? 0),
  };
}

export function totalCalls(u: UsageRow): number {
  return u.chat + u.receipt + u.report;
}

/** Count a call that is about to be made. Never throws; accounting is not the job. */
export async function recordCall(feature: AiFeature, now: Date = new Date()): Promise<void> {
  try {
    const current = await readUsage(now);
    const next: UsageRow = { ...current, [feature]: current[feature] + 1 };
    await prisma.setting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: next },
      update: { value: next },
    });
  } catch {
    // A failed counter must not fail the feature it is counting.
  }
}

export interface Allowance {
  allowed: boolean;
  /** Calls left before this feature must stop. */
  remaining: number;
  /** Of the whole day's budget, regardless of feature. */
  remainingOverall: number;
  reason?: 'BUDGET_SPENT' | 'RESERVED_FOR_WORK';
}

/**
 * May this feature make a call right now?
 *
 * Receipts and reports are limited only by the budget itself. Chat is limited
 * by the budget less the reserve, which is what makes it yield.
 */
export function allowanceFor(feature: AiFeature, usage: UsageRow, budget: AiBudget): Allowance {
  const used = totalCalls(usage);
  const remainingOverall = Math.max(0, budget.dailyCalls - used);

  if (feature !== 'chat') {
    return {
      allowed: remainingOverall > 0,
      remaining: remainingOverall,
      remainingOverall,
      ...(remainingOverall > 0 ? {} : { reason: 'BUDGET_SPENT' as const }),
    };
  }

  const chatCeiling = Math.max(0, budget.dailyCalls - budget.reservedForWork);
  const remaining = Math.max(0, Math.min(chatCeiling - used, remainingOverall));
  if (remaining > 0) return { allowed: true, remaining, remainingOverall };

  return {
    allowed: false,
    remaining: 0,
    remainingOverall,
    reason: remainingOverall > 0 ? 'RESERVED_FOR_WORK' : 'BUDGET_SPENT',
  };
}

export async function checkAllowance(
  feature: AiFeature,
  now: Date = new Date(),
): Promise<Allowance> {
  const [usage, budget] = await Promise.all([readUsage(now), getAiBudget()]);
  return allowanceFor(feature, usage, budget);
}

/** What to tell someone whose question will not be answered today. */
export function allowanceMessage(a: Allowance): string {
  if (a.reason === 'RESERVED_FOR_WORK') {
    return `The assistant has used its share of today's free allowance. The rest is held back for reading receipts and drafting site reports, so those still work. Ask again tomorrow.`;
  }
  return `Today's free allowance is used up. It resets tomorrow.`;
}
