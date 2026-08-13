import { prisma } from '../lib/prisma';
import { generate } from './ai';
import { recordCall } from './aiUsage';

/**
 * Drafting the weekly summary from the week's own daily reports.
 *
 * A weekly report is a roll-up of what supervisors already wrote each
 * evening — the office wants the week's shape (what got done, what's
 * blocking, what's next), not a re-typing of seven diary entries. So this
 * drafts FROM the daily reports' own prose, the same way the daily draft
 * writes from attendance and task records: the model summarises what was
 * already recorded, it never invents a day that wasn't filed.
 *
 * Milestones and issues also get grounded counts alongside the prose —
 * tasks actually marked DONE that week, defects actually raised and
 * resolved, safety incidents actually logged — pulled straight from the
 * tables, never from the model. Same rule as every other drafting feature
 * in this app: a figure in the draft is a figure that was already true.
 */

export interface WeekSummary {
  weekEnding: Date;
  from: Date;
  to: Date;
  projectName: string;
  /** How many of the week's days actually had a diary entry filed. */
  daysReported: number;
  dailyEntries: {
    date: Date;
    workCompleted: string;
    workersPresent: number;
    materialsUsed: string | null;
    challenges: string | null;
    delays: string | null;
    safetyNotes: string | null;
  }[];
  tasksCompleted: string[];
  snagsRaised: number;
  snagsResolved: number;
  safetyIncidents: { severity: string; description: string }[];
  /** True when no daily report was filed at all this week — nothing to draft from. */
  empty: boolean;
}

const weekBounds = (weekEnding: Date) => {
  const to = new Date(weekEnding);
  to.setHours(23, 59, 59, 999);
  const from = new Date(weekEnding);
  from.setDate(from.getDate() - 6);
  from.setHours(0, 0, 0, 0);
  return { from, to };
};

/**
 * Everything the system already knows about one site for the week ending
 * on the given date. Pure database work, returned to the caller as well as
 * fed to the model, so a supervisor can see what the draft was based on.
 */
export async function gatherWeek(projectId: string, weekEnding: Date): Promise<WeekSummary> {
  const { from, to } = weekBounds(weekEnding);

  const [project, dailyReports, tasksDone, snagsRaised, snagsResolved, incidents] =
    await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } }),
      prisma.dailyReport.findMany({
        where: { projectId, date: { gte: from, lte: to } },
        select: {
          date: true,
          workCompleted: true,
          workersPresent: true,
          materialsUsed: true,
          challenges: true,
          delays: true,
          safetyNotes: true,
        },
        orderBy: { date: 'asc' },
      }),
      prisma.task.findMany({
        where: { projectId, status: 'DONE', updatedAt: { gte: from, lte: to } },
        select: { name: true },
        take: 60,
      }),
      prisma.snagItem.count({ where: { projectId, createdAt: { gte: from, lte: to } } }),
      prisma.snagItem.count({ where: { projectId, resolvedAt: { gte: from, lte: to } } }),
      prisma.safetyIncident.findMany({
        where: { projectId, occurredAt: { gte: from, lte: to } },
        select: { severity: true, description: true },
        take: 20,
      }),
    ]);

  return {
    weekEnding,
    from,
    to,
    projectName: project.name,
    daysReported: dailyReports.length,
    dailyEntries: dailyReports,
    tasksCompleted: tasksDone.map((t) => t.name),
    snagsRaised,
    snagsResolved,
    safetyIncidents: incidents.map((i) => ({ severity: i.severity, description: i.description })),
    empty: dailyReports.length === 0,
  };
}

export interface DraftedWeeklyReport {
  summary: string;
  milestones: string | null;
  issues: string | null;
  nextWeekPlan: string | null;
}

const SYSTEM_PROMPT = `You write the weekly progress summary for a Kenyan construction company, from the site's own daily reports filed that week.

Return ONLY a JSON object with exactly these keys:
{
  "summary": string,
  "milestones": string|null,
  "issues": string|null,
  "nextWeekPlan": string|null
}

Rules:
- Use ONLY what the daily reports and the counts given actually say. Never invent progress, dates, quantities or plans that are not there.
- "summary" pulls together what the week's daily reports describe as work completed — the overall shape of the week, not a day-by-day retelling. Three to five sentences.
- "milestones" lists what was finished this week, drawing on the tasks marked done and anything the daily reports describe as completed. Null if nothing was.
- "issues" covers delays, challenges and defects the daily reports raised, plus any safety incidents logged. Null if none were recorded.
- "nextWeekPlan" ONLY if a daily report explicitly mentions what is planned next; otherwise null — do not guess at a plan nobody wrote down.
- Do not begin with "This week" or the date. Do not sign off. Plain factual sentences, no praise, no filler.`;

/** The facts, as the model sees them. Kept readable so it can be shown to the user. */
export function factsFor(week: WeekSummary): string {
  const lines: string[] = [
    `Site: ${week.projectName}`,
    `${week.daysReported} of 7 days had a diary entry filed.`,
  ];
  for (const d of week.dailyEntries) {
    const iso = d.date.toISOString().slice(0, 10);
    lines.push(`\n${iso} (${d.workersPresent} workers): ${d.workCompleted}`);
    if (d.materialsUsed) lines.push(`  Materials: ${d.materialsUsed}`);
    if (d.challenges) lines.push(`  Challenges: ${d.challenges}`);
    if (d.delays) lines.push(`  Delays: ${d.delays}`);
    if (d.safetyNotes) lines.push(`  Safety: ${d.safetyNotes}`);
  }
  if (week.tasksCompleted.length) {
    lines.push(`\nTasks marked done this week: ${week.tasksCompleted.join('; ')}`);
  }
  if (week.snagsRaised > 0 || week.snagsResolved > 0) {
    lines.push(`\nDefects: ${week.snagsRaised} raised, ${week.snagsResolved} resolved this week.`);
  }
  if (week.safetyIncidents.length) {
    lines.push(
      `\nSafety incidents: ${week.safetyIncidents.map((i) => `${i.severity.replace(/_/g, ' ').toLowerCase()} — ${i.description}`).join('; ')}`,
    );
  }
  return lines.join('\n');
}

/** Parse the model's reply. Untrusted input: unexpected shapes are dropped rather than passed through. */
export function parseWeeklyDraft(text: string): DraftedWeeklyReport {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('unparseable');
  }
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;

  const str = (v: unknown, max = 3000): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t === '' || t.toLowerCase() === 'null' ? null : t.slice(0, max);
  };

  return {
    summary: str(raw.summary) ?? '',
    milestones: str(raw.milestones),
    issues: str(raw.issues),
    nextWeekPlan: str(raw.nextWeekPlan),
  };
}

/**
 * Draft the weekly summary from a week already gathered.
 *
 * Returns prose only. `daysReported` and every count came from `gatherWeek`,
 * and the caller sends both so the supervisor can see the evidence beside
 * the words.
 */
export async function draftWeeklyReport(week: WeekSummary): Promise<DraftedWeeklyReport> {
  await recordCall('report');
  const text = await generate({
    system: SYSTEM_PROMPT,
    user: `Write the weekly summary from these facts:\n\n${factsFor(week)}`,
    json: true,
    maxTokens: 900,
    noun: 'report',
  });
  return parseWeeklyDraft(text);
}
