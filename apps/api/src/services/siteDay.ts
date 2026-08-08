import { prisma } from '../lib/prisma';
import { env } from '../config/env';

/**
 * When the working day is supposed to start on site, and therefore what counts
 * as "late".
 *
 * This has to be a setting rather than a constant because it is a company
 * policy, not a fact about the software — a site that starts at 07:00 would
 * otherwise have every worker permanently marked late. It lives here rather
 * than in finance.ts because nothing about it is financial.
 */
export const DEFAULT_SITE_DAY_START = '07:30';

/** Minutes past the start time before a check-in is called late. */
export const DEFAULT_LATE_GRACE_MINUTES = 15;

export interface SiteDaySettings {
  /** "HH:MM", in APP_TIMEZONE. */
  dayStart: string;
  lateGraceMinutes: number;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function getSiteDaySettings(): Promise<SiteDaySettings> {
  const row = await prisma.setting.findUnique({ where: { key: 'siteDay' } });
  const v = (row?.value ?? {}) as Partial<SiteDaySettings>;
  const dayStart = typeof v.dayStart === 'string' && HHMM.test(v.dayStart) ? v.dayStart : DEFAULT_SITE_DAY_START;
  const grace =
    typeof v.lateGraceMinutes === 'number' && v.lateGraceMinutes >= 0 && v.lateGraceMinutes <= 240
      ? Math.round(v.lateGraceMinutes)
      : DEFAULT_LATE_GRACE_MINUTES;
  return { dayStart, lateGraceMinutes: grace };
}

/**
 * Minutes past midnight of a timestamp, read in the app's configured timezone.
 *
 * Attendance timestamps are stored as absolute instants, but "late" is a local
 * wall-clock question — comparing UTC hours would put every Nairobi site three
 * hours out.
 */
export function localMinutesOfDay(at: Date, timeZone = env.APP_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

export function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** True when this check-in is past the start time plus the grace period. */
export function isLateCheckIn(checkIn: Date, settings: SiteDaySettings): boolean {
  return localMinutesOfDay(checkIn) > parseHHMM(settings.dayStart) + settings.lateGraceMinutes;
}
