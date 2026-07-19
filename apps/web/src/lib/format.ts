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
