const kes = new Intl.NumberFormat('en-KE', {
  style: 'currency',
  currency: 'KES',
  maximumFractionDigits: 0,
});

export const fmtMoney = (n: number) => kes.format(n);

export const fmtCompact = (n: number) =>
  `KES ${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`;

export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtTime = (d: string | Date) =>
  new Date(d).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A calendar date, as the user's own clock sees it.
 *
 * `toISOString().slice(0, 10)` is UTC, and this is used east of it. In Kenya
 * (UTC+3) a Date built at local midnight — the first of the month, say — is
 * 21:00 the previous day in UTC, so formatting it that way silently returns
 * the wrong day. That is a payroll period starting on the 31st of the month
 * before, an invoice landing in the wrong VAT month, and a diary filed against
 * a day that already had one.
 *
 * Every date this app sends to the API as YYYY-MM-DD goes through here.
 */
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayISO = () => isoDate(new Date());

/**
 * Parse YYYY-MM-DD as a local calendar date.
 *
 * `new Date('2026-08-10')` is defined as UTC midnight, which is the previous
 * evening in the western hemisphere — so the naive round trip loses a day
 * there just as `toISOString` loses one here.
 */
export const parseISODate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

/** Shift a YYYY-MM-DD date by whole days, staying in local time throughout. */
export const addDays = (iso: string, days: number) => {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
};

/** `datetime-local` wants local wall-clock time, never UTC. */
export const nowLocalDateTime = () => {
  const d = new Date();
  return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Signed file URLs already carry ?exp=&sig=; appending &w= asks the server
// for a cached, resized JPEG instead of the full-size original — the API
// only pre-generates a fixed set of widths (see ALLOWED_THUMB_WIDTHS in
// upload.ts), so pass one of those exact values.
export const thumbUrl = (url: string, width: 160 | 320) => `${url}&w=${width}`;
