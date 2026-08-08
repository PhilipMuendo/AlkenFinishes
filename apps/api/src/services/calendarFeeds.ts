import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';
import { dlpEnd } from './pipeline';

/**
 * The calendar entries nobody should have to type.
 *
 * A project deadline, a retention release, an equipment service and a birthday
 * are all already recorded somewhere — as a completion date, a defects
 * liability period, a service date, a date of birth. Copying them into
 * CalendarEvent rows would create a second copy that goes stale the moment the
 * source moves, so these are computed on read instead and never persisted.
 *
 * Derived events carry a synthetic id and `derived: true`; the calendar API
 * refuses to delete them, because the way to remove one is to change the record
 * it comes from.
 */

export type DerivedEventType =
  | 'PROJECT_DEADLINE'
  | 'PAYROLL'
  | 'EQUIPMENT_SERVICE'
  | 'BIRTHDAY'
  | 'RETENTION_DUE'
  | 'WARRANTY_EXPIRY';

export interface DerivedEvent {
  id: string;
  derived: true;
  type: DerivedEventType;
  title: string;
  date: Date;
  notes: string | null;
  projectId: string | null;
  project: { id: string; name: string } | null;
}

/** Friday, as a JS day index. */
export const DEFAULT_PAYROLL_DAY = 5;

export interface CalendarFeedSettings {
  /** 0 = Sunday … 6 = Saturday. */
  payrollDayOfWeek: number;
  payrollEnabled: boolean;
}

export async function getCalendarFeedSettings(): Promise<CalendarFeedSettings> {
  const row = await prisma.setting.findUnique({ where: { key: 'calendarFeeds' } });
  const v = (row?.value ?? {}) as Partial<CalendarFeedSettings>;
  return {
    payrollDayOfWeek:
      typeof v.payrollDayOfWeek === 'number' && v.payrollDayOfWeek >= 0 && v.payrollDayOfWeek <= 6
        ? Math.round(v.payrollDayOfWeek)
        : DEFAULT_PAYROLL_DAY,
    payrollEnabled: v.payrollEnabled ?? true,
  };
}

const DAY = 86_400_000;
/** Guard against an unbounded range turning payroll into a million rows. */
const MAX_RANGE_DAYS = 800;

const utcDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const startOfUtcDay = (d: Date) => utcDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Every derived event between `from` and `to`, inclusive.
 *
 * `projectScope` is the caller's already-computed access filter, so a
 * supervisor's derived feed is restricted to their own sites by exactly the
 * same rule as their stored events — the scoping is not reimplemented here.
 */
export async function derivedEvents(opts: {
  from: Date;
  to: Date;
  projectFilter: Prisma.ProjectWhereInput | null;
  projectId?: string;
  /** Birthdays and payroll are company-wide; a supervisor has no use for them. */
  includeCompanyWide: boolean;
}): Promise<DerivedEvent[]> {
  const from = startOfUtcDay(opts.from);
  const to = startOfUtcDay(opts.to);
  if (to < from) return [];
  const rangeDays = Math.round((to.getTime() - from.getTime()) / DAY);
  if (rangeDays > MAX_RANGE_DAYS) return [];

  const projectWhere: Prisma.ProjectWhereInput = {
    ...(opts.projectFilter ?? {}),
    ...(opts.projectId ? { id: opts.projectId } : {}),
    status: { notIn: ['CANCELLED'] },
  };

  const settings = await getCalendarFeedSettings();

  const [projects, contracts, tools, workers] = await Promise.all([
    prisma.project.findMany({
      where: { ...projectWhere, expectedCompletion: { gte: from, lte: to } },
      select: { id: true, name: true, expectedCompletion: true, status: true },
    }),
    // Retention and warranty both hang off the defects liability clock, which
    // only starts at practical completion.
    prisma.contract.findMany({
      where: {
        practicalCompletionDate: { not: null },
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
        ...(opts.projectFilter ? { project: projectWhere } : {}),
      },
      select: {
        id: true,
        title: true,
        projectId: true,
        practicalCompletionDate: true,
        defectsLiabilityMonths: true,
        project: { select: { id: true, name: true } },
      },
    }),
    prisma.tool.findMany({
      where: {
        nextServiceDate: { gte: from, lte: to },
        status: { not: 'RETIRED' },
        ...(opts.projectId ? { currentProjectId: opts.projectId } : {}),
      },
      select: {
        id: true,
        name: true,
        nextServiceDate: true,
        currentProject: { select: { id: true, name: true } },
      },
    }),
    opts.includeCompanyWide
      ? prisma.worker.findMany({
          where: { dateOfBirth: { not: null }, status: 'ACTIVE' },
          select: { id: true, name: true, trade: true, dateOfBirth: true },
        })
      : Promise.resolve([]),
  ]);

  const out: DerivedEvent[] = [];

  for (const p of projects) {
    out.push({
      id: `deadline:${p.id}`,
      derived: true,
      type: 'PROJECT_DEADLINE',
      title: `${p.name} — contractual completion`,
      date: startOfUtcDay(p.expectedCompletion),
      notes: null,
      projectId: p.id,
      project: { id: p.id, name: p.name },
    });
  }

  for (const c of contracts) {
    const end = dlpEnd(c.practicalCompletionDate, c.defectsLiabilityMonths);
    if (!end) continue;
    const endDate = startOfUtcDay(new Date(end));
    if (endDate < from || endDate > to) continue;
    const project = c.project ? { id: c.project.id, name: c.project.name } : null;
    // Two different obligations that happen to fall on the same day: the
    // warranty stops, and the retention becomes payable. An owner needs both.
    out.push({
      id: `warranty:${c.id}`,
      derived: true,
      type: 'WARRANTY_EXPIRY',
      title: `${c.title} — defects liability ends`,
      date: endDate,
      notes: `${c.defectsLiabilityMonths} months from practical completion`,
      projectId: c.projectId,
      project,
    });
    out.push({
      id: `retention:${c.id}`,
      derived: true,
      type: 'RETENTION_DUE',
      title: `${c.title} — retention released`,
      date: endDate,
      notes: 'Raise the retention invoice',
      projectId: c.projectId,
      project,
    });
  }

  for (const t of tools) {
    out.push({
      id: `service:${t.id}`,
      derived: true,
      type: 'EQUIPMENT_SERVICE',
      title: `${t.name} — service due`,
      date: startOfUtcDay(t.nextServiceDate!),
      notes: t.currentProject ? `On site at ${t.currentProject.name}` : 'In central store',
      projectId: t.currentProject?.id ?? null,
      project: t.currentProject ?? null,
    });
  }

  for (const w of workers) {
    const dob = w.dateOfBirth!;
    // A birthday recurs, so check it against every year the range touches
    // rather than the year it was born in.
    for (let year = from.getUTCFullYear(); year <= to.getUTCFullYear(); year++) {
      const occurrence = utcDate(year, dob.getUTCMonth(), dob.getUTCDate());
      if (occurrence < from || occurrence > to) continue;
      out.push({
        id: `birthday:${w.id}:${year}`,
        derived: true,
        type: 'BIRTHDAY',
        title: `${w.name}’s birthday`,
        date: occurrence,
        notes: w.trade,
        projectId: null,
        project: null,
      });
    }
  }

  if (opts.includeCompanyWide && settings.payrollEnabled) {
    const dayName = DAY_NAMES[settings.payrollDayOfWeek];
    for (let t = from.getTime(); t <= to.getTime(); t += DAY) {
      const d = new Date(t);
      if (d.getUTCDay() !== settings.payrollDayOfWeek) continue;
      out.push({
        id: `payroll:${d.toISOString().slice(0, 10)}`,
        derived: true,
        type: 'PAYROLL',
        title: `Payroll ${dayName}`,
        date: d,
        notes: null,
        projectId: null,
        project: null,
      });
    }
  }

  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}
