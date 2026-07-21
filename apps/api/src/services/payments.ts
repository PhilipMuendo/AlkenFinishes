export type Health = 'GREEN' | 'YELLOW' | 'RED' | 'NONE';

const DUE_SOON_DAYS = 14;

/**
 * Colors the pending-balance due date, not a percentage — RED once overdue,
 * YELLOW within DUE_SOON_DAYS, GREEN otherwise, NONE if fully paid or no
 * due date has been set yet.
 */
export function dueDateHealth(pendingBalance: number, dueDate: Date | null): Health {
  if (pendingBalance <= 0 || !dueDate) return 'NONE';
  const days = (new Date(dueDate).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return 'RED';
  if (days <= DUE_SOON_DAYS) return 'YELLOW';
  return 'GREEN';
}
