import { prisma } from '../lib/prisma';
import { generate } from './ai';

/**
 * Drafting the evening site diary.
 *
 * The report is the most-skipped job in the app, and the reason is obvious:
 * at six in the evening, on a phone, a supervisor is asked to retype things
 * the system already knows. Attendance knows who was on site. The programme
 * knows which tasks moved. The snag list knows what was raised and fixed.
 *
 * THE FIGURES ARE NEVER DRAFTED. `workersPresent` and every count below come
 * from the database, not from the model — the same rule as the receipt reader,
 * for the same reason. What the model does is turn facts already established
 * into the prose a supervisor would otherwise type, and it produces a DRAFT
 * they edit and submit. Nothing is ever filed automatically: the diary is a
 * contemporaneous record of what somebody saw, and one nobody read is worth
 * less than a blank page.
 */

export interface DaySummary {
  date: Date;
  projectName: string;
  /** Counted from attendance, never drafted. */
  workersPresent: number;
  workerNames: string[];
  trades: string[];
  hoursWorked: number;
  tasksCompleted: string[];
  tasksInProgress: string[];
  snagsRaised: { title: string; severity: string }[];
  snagsResolved: string[];
  materialsDelivered: string[];
  safetyIncidents: { severity: string; description: string }[];
  toolsDelivered: string[];
  /** True when nothing at all was recorded, so there is nothing to draft from. */
  empty: boolean;
}

const dayBounds = (date: Date) => {
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setHours(23, 59, 59, 999);
  return { from, to };
};

/**
 * Everything the system already knows about one day on one site.
 *
 * Pure database work: this is the evidence the draft is built from, and it is
 * returned to the caller as well as fed to the model, so a supervisor can see
 * what the draft was based on rather than being asked to trust it.
 */
export async function gatherDay(projectId: string, date: Date): Promise<DaySummary> {
  const { from, to } = dayBounds(date);

  const [project, attendance, tasks, snagsRaised, snagsResolved, deliveries, incidents, tools] =
    await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } }),
      prisma.attendanceRecord.findMany({
        where: { projectId, date: { gte: from, lte: to } },
        select: { hoursWorked: true, worker: { select: { name: true, trade: true } } },
      }),
      prisma.task.findMany({
        where: { projectId, updatedAt: { gte: from, lte: to } },
        select: { name: true, status: true },
        take: 60,
      }),
      prisma.snagItem.findMany({
        where: { projectId, createdAt: { gte: from, lte: to } },
        select: { title: true, severity: true },
        take: 40,
      }),
      prisma.snagItem.findMany({
        where: { projectId, resolvedAt: { gte: from, lte: to } },
        select: { title: true },
        take: 40,
      }),
      prisma.materialRequest.findMany({
        where: { projectId, fulfilledAt: { gte: from, lte: to } },
        select: { itemName: true, quantity: true, unit: true },
        take: 40,
      }),
      prisma.safetyIncident.findMany({
        where: { projectId, occurredAt: { gte: from, lte: to } },
        select: { severity: true, description: true },
        take: 20,
      }),
      prisma.toolTransfer.findMany({
        where: { toProjectId: projectId, transferDate: { gte: from, lte: to } },
        select: { tool: { select: { name: true } } },
        take: 20,
      }),
    ]);

  const workerNames = [...new Set(attendance.map((a) => a.worker.name))];
  const trades = [...new Set(attendance.map((a) => a.worker.trade).filter(Boolean))];
  const hoursWorked =
    Math.round(attendance.reduce((s, a) => s + Number(a.hoursWorked ?? 0), 0) * 10) / 10;

  const summary: DaySummary = {
    date: from,
    projectName: project.name,
    workersPresent: workerNames.length,
    workerNames,
    trades,
    hoursWorked,
    tasksCompleted: tasks.filter((t) => t.status === 'DONE').map((t) => t.name),
    tasksInProgress: tasks.filter((t) => t.status === 'IN_PROGRESS').map((t) => t.name),
    snagsRaised: snagsRaised.map((s) => ({ title: s.title, severity: s.severity })),
    snagsResolved: snagsResolved.map((s) => s.title),
    materialsDelivered: deliveries.map((d) => `${d.quantity} ${d.unit} ${d.itemName}`),
    safetyIncidents: incidents.map((i) => ({ severity: i.severity, description: i.description })),
    toolsDelivered: tools.map((t) => t.tool.name),
    empty: false,
  };

  summary.empty =
    attendance.length === 0 &&
    tasks.length === 0 &&
    snagsRaised.length === 0 &&
    snagsResolved.length === 0 &&
    deliveries.length === 0 &&
    incidents.length === 0 &&
    tools.length === 0;

  return summary;
}

export interface DraftedReport {
  workCompleted: string;
  materialsUsed: string | null;
  challenges: string | null;
  safetyNotes: string | null;
}

const SYSTEM_PROMPT = `You write the evening site diary for a Kenyan construction company, from facts already recorded during the day.

Return ONLY a JSON object with exactly these keys:
{
  "workCompleted": string,
  "materialsUsed": string|null,
  "challenges": string|null,
  "safetyNotes": string|null
}

Rules:
- Write plainly, as a site supervisor would: short factual sentences, no adjectives, no praise, no filler.
- Use ONLY the facts given. Never invent work, progress, quantities, delays or people. If nothing is recorded for a field, return null for it rather than padding it.
- Do NOT state a number of workers, hours or quantities unless it appears in the facts. The form carries the counts separately.
- "workCompleted" is what was done. If tasks were completed, say so; if work was only in progress, say that instead. Never imply something finished when it did not.
- "challenges" covers defects raised, delays and anything that held work up. Null if nothing did.
- "safetyNotes" only if a safety incident is listed. Null otherwise.
- Do not begin with "Today" or the date. Do not sign off. Two to four sentences for workCompleted, one or two for the others.`;

/** The facts, as the model sees them. Kept readable so it can be shown to the user. */
export function factsFor(day: DaySummary): string {
  const lines: string[] = [`Site: ${day.projectName}`];
  if (day.workersPresent > 0) {
    lines.push(
      `Workers on site: ${day.workersPresent}${day.trades.length ? ` (${day.trades.join(', ')})` : ''}`,
    );
  }
  if (day.tasksCompleted.length) lines.push(`Tasks completed: ${day.tasksCompleted.join('; ')}`);
  if (day.tasksInProgress.length) lines.push(`Tasks in progress: ${day.tasksInProgress.join('; ')}`);
  if (day.materialsDelivered.length) {
    lines.push(`Materials delivered: ${day.materialsDelivered.join('; ')}`);
  }
  if (day.toolsDelivered.length) lines.push(`Equipment arrived: ${day.toolsDelivered.join('; ')}`);
  if (day.snagsRaised.length) {
    lines.push(
      `Defects raised: ${day.snagsRaised.map((s) => `${s.title} (${s.severity.toLowerCase()})`).join('; ')}`,
    );
  }
  if (day.snagsResolved.length) lines.push(`Defects signed off: ${day.snagsResolved.join('; ')}`);
  if (day.safetyIncidents.length) {
    lines.push(
      `Safety: ${day.safetyIncidents.map((i) => `${i.severity.replace(/_/g, ' ').toLowerCase()} — ${i.description}`).join('; ')}`,
    );
  }
  return lines.join('\n');
}

/**
 * Parse the model's reply.
 *
 * Untrusted input, like every other model reply here: unexpected shapes are
 * coerced or dropped rather than passed through into a form.
 */
export function parseDraft(text: string): DraftedReport {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('unparseable');
  }
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;

  const str = (v: unknown, max = 2000): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t === '' || t.toLowerCase() === 'null' ? null : t.slice(0, max);
  };

  return {
    workCompleted: str(raw.workCompleted) ?? '',
    materialsUsed: str(raw.materialsUsed),
    challenges: str(raw.challenges),
    safetyNotes: str(raw.safetyNotes),
  };
}

/**
 * Draft the diary for one day.
 *
 * Returns prose only. Every count the form needs comes from `gatherDay`, and
 * the caller sends both so the supervisor can see the evidence beside the
 * words.
 */
export async function draftDailyReport(day: DaySummary): Promise<DraftedReport> {
  const text = await generate({
    system: SYSTEM_PROMPT,
    user: `Write the diary from these facts:\n\n${factsFor(day)}`,
    json: true,
    maxTokens: 700,
    noun: 'report',
  });
  return parseDraft(text);
}
