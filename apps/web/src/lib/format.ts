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

export const todayISO = () => new Date().toISOString().slice(0, 10);

// Signed file URLs already carry ?exp=&sig=; appending &w= asks the server
// for a cached, resized JPEG instead of the full-size original — the API
// only pre-generates a fixed set of widths (see ALLOWED_THUMB_WIDTHS in
// upload.ts), so pass one of those exact values.
export const thumbUrl = (url: string, width: 160 | 320) => `${url}&w=${width}`;
