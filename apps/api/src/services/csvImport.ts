import * as XLSX from 'xlsx';
import type { Punch } from './attendanceIngest';

/**
 * Turns a uAttend (or similar closed cloud clock) CSV/Excel export into the
 * same Punch[] shape ingestPunches() already consumes for ZKTeco and Suprema
 * devices — one aggregation pipeline for every vendor, regardless of how the
 * punches arrived.
 *
 * uAttend's exact export columns aren't publicly documented and vary by
 * report (Punch Report: one row per punch; Timecard Report: one row per day
 * with separate time-in/time-out columns), so this reads headers loosely by
 * alias rather than assuming one fixed layout — the same approach
 * modules/workers.ts already uses for its own spreadsheet import.
 *
 * The Employee ID column must match the worker's biometricId already stored
 * in AlkenFinishes (Settings > Attendance), the same convention as a ZKTeco
 * PIN or a BioStar 2 User ID.
 */

const HEADER_ALIASES: Record<string, string[]> = {
  employeeId: ['employee id', 'emp id', 'empid', 'employee', 'badge', 'badge id', 'pin', 'id'],
  date: ['date'],
  timeIn: ['time in', 'clock in', 'punch in', 'in'],
  timeOut: ['time out', 'clock out', 'punch out', 'out'],
  // A punch-log style export: one row per punch, one combined column.
  timestamp: ['time', 'timestamp', 'punch time', 'date/time', 'datetime', 'date time'],
};

function normalizeRow(raw: Record<string, unknown>): Record<string, string> {
  const lowerEntries = Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase(), v] as const);
  const out: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const hit = lowerEntries.find(([k]) => aliases.includes(k));
    if (hit && hit[1] != null && String(hit[1]).trim() !== '') out[field] = String(hit[1]).trim();
  }
  return out;
}

/** Parses one date/time-ish cell. Excel/xlsx hands back a JS Date for real date cells; a plain CSV hands back text. */
function parseCell(value: string | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "7:30", "07:30:00", "7:30 AM" — bare clock time with no date, the normal shape of a Time In/Out CSV column. */
function parseTimeOfDay(value: string): { h: number; m: number; s: number } | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(value.trim());
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3] ?? '0');
  const ampm = match[4]?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h > 23 || m > 59 || s > 59) return null;
  return { h, m, s };
}

/**
 * A Time In/Time Out cell: a real Date object (from xlsx's cellDates) is used
 * as-is — combine() below only reads its hour/minute/second, so whichever
 * epoch day Excel anchored a time-only cell to doesn't matter. A CSV cell is
 * plain text and is usually bare clock time ("07:30:00") with no date of its
 * own, which native Date parsing rejects — parseTimeOfDay() is the fallback
 * that actually covers the common case.
 */
function parseTimeCell(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const full = parseCell(value);
  if (full) return full;
  const t = parseTimeOfDay(value);
  return t ? new Date(1970, 0, 1, t.h, t.m, t.s) : null;
}

/** Combines a "date" cell with a "time" cell into one timestamp — needed when they arrive as separate columns. */
function combine(date: Date, time: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    time.getHours(),
    time.getMinutes(),
    time.getSeconds(),
  );
}

export interface ImportRowIssue {
  row: number;
  reason: string;
}

export interface ParsedImport {
  punches: Punch[];
  rowIssues: ImportRowIssue[];
}

const MAX_IMPORT_ROWS = 5000;

export class CsvImportError extends Error {}

const WEEKDAY = /^(mon|tue|wed|thu|fri|sat|sun)/i;
const DATE_RANGE = /(\d{4})-(\d{2})-(\d{2})\s*~\s*(\d{4})-(\d{2})-(\d{2})/;
const CLOCK_TIME = /\b(\d{1,2}):(\d{2})\b/g;

/**
 * The "Attendance Logs" sheet of an "All Report" workbook exported by the
 * generic face/fingerprint time-attendance terminals (Menu > Attendance >
 * Download All Report). The workbook's other sheets (Attendance summary,
 * Abnormal, …) are the terminal's own shift analysis — they say "Missed" where
 * a punch fell outside its shift windows — so they are ignored; first-in /
 * last-out is ingestPunches()'s job, from the raw punches.
 *
 * Layout: one block per employee. A header row ("ID", "", <id>, … "Name", …),
 * then a row of day numbers, a row of weekday names, and a row where each day's
 * column holds that day's punch times, newline-separated ("13:41\n14:40").
 * The year and month come from the "YYYY-MM-DD ~ YYYY-MM-DD" range at the top;
 * a day number that drops below the previous one means the range rolled into
 * the next month.
 */
function parseAttendanceLogsSheet(sheet: XLSX.WorkSheet): ParsedImport {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' });
  const text = (row: unknown[]) => row.map((c) => String(c ?? '').trim());

  const range = DATE_RANGE.exec(
    grid
      .slice(0, 5)
      .map((r) => text(r).join(' '))
      .join(' '),
  );
  if (!range) throw new CsvImportError('Could not find the report date range at the top of the "Attendance Logs" sheet');
  const startYear = Number(range[1]);
  const startMonth = Number(range[2]);

  const punches: Punch[] = [];
  const rowIssues: ImportRowIssue[] = [];
  let employeeId: string | null = null;
  let days: Map<number, { y: number; mo: number; d: number }> | null = null;

  grid.forEach((raw, i) => {
    const cells = text(raw);
    if (cells[0] === 'ID') {
      employeeId = cells.slice(1).find(Boolean) ?? null;
      days = null;
      if (!employeeId) rowIssues.push({ row: i + 1, reason: 'employee block has no ID' });
      return;
    }
    if (!employeeId) return;

    if (!days) {
      const filled = cells.filter(Boolean);
      if (filled.length === 0 || !filled.every((c) => /^\d{1,2}$/.test(c))) return;
      days = new Map();
      let y = startYear;
      let mo = startMonth;
      let prev = 0;
      cells.forEach((c, col) => {
        if (!c) return;
        const d = Number(c);
        if (d < prev) {
          mo += 1;
          if (mo > 12) {
            mo = 1;
            y += 1;
          }
        }
        prev = d;
        days!.set(col, { y, mo, d });
      });
      return;
    }

    const filled = cells.filter(Boolean);
    if (filled.length > 0 && filled.every((c) => WEEKDAY.test(c))) return;

    cells.forEach((c, col) => {
      const day = days!.get(col);
      if (!day || !c) return;
      for (const m of c.matchAll(CLOCK_TIME)) {
        const h = Number(m[1]);
        const mi = Number(m[2]);
        if (h > 23 || mi > 59) {
          rowIssues.push({ row: i + 1, reason: `unreadable time "${m[0]}"` });
          continue;
        }
        // Local time, the same convention as the other import shapes.
        punches.push({ biometricId: employeeId!, timestamp: new Date(day.y, day.mo - 1, day.d, h, mi) });
      }
    });
  });

  return { punches, rowIssues };
}

/** Reads a CSV/XLS/XLSX buffer into Punch[], skipping rows it can't place and reporting why. */
export function parsePunchFile(buffer: Buffer): ParsedImport {
  let sheetRows: Record<string, unknown>[];
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const logsSheet = workbook.SheetNames.find((n) => n.trim().toLowerCase() === 'attendance logs');
    if (logsSheet) return parseAttendanceLogsSheet(workbook.Sheets[logsSheet]);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    sheetRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } catch (err) {
    if (err instanceof CsvImportError) throw err;
    throw new CsvImportError('Could not read the file — is it a valid CSV/Excel export?');
  }
  if (sheetRows.length === 0) throw new CsvImportError('The file has no data rows');
  if (sheetRows.length > MAX_IMPORT_ROWS) {
    throw new CsvImportError(`Import is limited to ${MAX_IMPORT_ROWS} rows at a time — export a shorter date range`);
  }

  const punches: Punch[] = [];
  const rowIssues: ImportRowIssue[] = [];

  sheetRows.forEach((raw, i) => {
    const rowNum = i + 2; // header is row 1
    const r = normalizeRow(raw);
    if (!r.employeeId) {
      rowIssues.push({ row: rowNum, reason: 'no employee id column recognised' });
      return;
    }

    // Shape 1: a single combined date+time punch column (Punch Report style).
    if (r.timestamp) {
      const ts = parseCell(r.timestamp as unknown as string);
      if (!ts) {
        rowIssues.push({ row: rowNum, reason: `unreadable timestamp "${r.timestamp}"` });
        return;
      }
      punches.push({ biometricId: r.employeeId, timestamp: ts });
      return;
    }

    // Shape 2: separate date + time-in [+ time-out] columns (Timecard Report style).
    const dateCell = r.date ? parseCell(r.date as unknown as string) : null;
    if (!r.timeIn) {
      rowIssues.push({ row: rowNum, reason: 'no time-in or timestamp column recognised' });
      return;
    }
    const inCell = parseTimeCell(r.timeIn as unknown as string);
    if (!inCell) {
      rowIssues.push({ row: rowNum, reason: `unreadable time-in "${r.timeIn}"` });
      return;
    }
    const checkIn = dateCell ? combine(dateCell, inCell) : inCell;
    punches.push({ biometricId: r.employeeId, timestamp: checkIn });

    if (r.timeOut) {
      const outCell = parseTimeCell(r.timeOut as unknown as string);
      if (outCell) {
        const checkOut = dateCell ? combine(dateCell, outCell) : outCell;
        punches.push({ biometricId: r.employeeId, timestamp: checkOut });
      } else {
        rowIssues.push({ row: rowNum, reason: `unreadable time-out "${r.timeOut}"` });
      }
    }
  });

  return { punches, rowIssues };
}
