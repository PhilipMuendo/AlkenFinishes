import type {
  AnyCalendarEventType,
  ContractStatus,
  ExpenseStatus,
  MaterialRequestStatus,
  ProjectStatus,
  QuotationStatus,
  SafetyIncidentSeverity,
  SnagSeverity,
  SnagStatus,
  TaskStatus,
  ToolStatus,
  Worker,
} from '@/lib/types';

/**
 * The badge palette, and every status that maps onto it.
 *
 * These maps used to live one-per-file — five separate `STATUS_TONE`
 * definitions plus a sixth, stringly-typed ladder inside `StatusBadge` that
 * compared against bare strings like `'DONE' || 'COMPLETED'`. Keeping them
 * here means a new status in `types.ts` fails to compile until it has been
 * given a colour, rather than silently falling through to grey.
 */
export type Tone = 'slate' | 'green' | 'yellow' | 'red' | 'blue';

export const projectStatusTone: Record<ProjectStatus, Tone> = {
  PLANNING: 'slate',
  ACTIVE: 'green',
  ON_HOLD: 'yellow',
  COMPLETED: 'blue',
  CANCELLED: 'red',
};

export const taskStatusTone: Record<TaskStatus, Tone> = {
  NOT_STARTED: 'slate',
  IN_PROGRESS: 'blue',
  BLOCKED: 'yellow',
  DONE: 'green',
};

export const workerStatusTone: Record<Worker['status'], Tone> = {
  ACTIVE: 'green',
  INACTIVE: 'slate',
};

export const expenseStatusTone: Record<ExpenseStatus, Tone> = {
  PENDING: 'yellow',
  APPROVED: 'green',
  REJECTED: 'red',
};

export const materialRequestStatusTone: Record<MaterialRequestStatus, Tone> = {
  PENDING: 'yellow',
  APPROVED: 'blue',
  REJECTED: 'red',
  FULFILLED: 'green',
};

export const snagStatusTone: Record<SnagStatus, Tone> = {
  OPEN: 'red',
  IN_PROGRESS: 'yellow',
  RESOLVED: 'blue',
  VERIFIED: 'green',
};

export const snagSeverityTone: Record<SnagSeverity, Tone> = {
  LOW: 'slate',
  MEDIUM: 'yellow',
  HIGH: 'red',
};

export const safetySeverityTone: Record<SafetyIncidentSeverity, Tone> = {
  NEAR_MISS: 'slate',
  MINOR: 'yellow',
  SERIOUS: 'red',
};

export const contractStatusTone: Record<ContractStatus, Tone> = {
  DRAFT: 'slate',
  ISSUED: 'blue',
  SIGNED: 'green',
  ACTIVE: 'green',
  COMPLETED: 'slate',
  TERMINATED: 'red',
};

export const quotationStatusTone: Record<QuotationStatus, Tone> = {
  DRAFT: 'slate',
  SENT: 'blue',
  ACCEPTED: 'green',
  REJECTED: 'red',
  EXPIRED: 'yellow',
};

export const toolStatusTone: Record<ToolStatus, Tone> = {
  ACTIVE: 'green',
  MAINTENANCE: 'yellow',
  RETIRED: 'slate',
};

export const calendarEventTone: Record<AnyCalendarEventType, Tone> = {
  MILESTONE: 'blue',
  INSPECTION: 'yellow',
  DELIVERY: 'green',
  MEETING: 'slate',
  SITE_VISIT: 'blue',
  CLIENT_APPOINTMENT: 'blue',
  OTHER: 'slate',
  // Dates with money or a deadline behind them read louder than a meeting.
  PROJECT_DEADLINE: 'red',
  RETENTION_DUE: 'green',
  WARRANTY_EXPIRY: 'yellow',
  EQUIPMENT_SERVICE: 'yellow',
  PAYROLL: 'green',
  BIRTHDAY: 'slate',
};

/** Turns `IN_PROGRESS` into `In progress` for display. */
export function humanizeStatus(status: string): string {
  const spaced = status.replaceAll('_', ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
