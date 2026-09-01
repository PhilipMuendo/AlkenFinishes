/**
 * Who may see what a person is paid.
 *
 * Pay rates are the office's business — Superadmin and Accountant alike. A
 * supervisor runs the site and records who was on it; what those hours cost
 * is decided and seen by the office.
 *
 * The rule has to cover the derived figure as well as the rate itself. An
 * attendance record carries `labourCost`, and cost divided by hours is the
 * rate — removing the input while leaving the cost on screen would look like a
 * boundary and not be one. So both go, together, in one place, and every route
 * that returns a worker or an attendance record passes through here.
 *
 * A worker created by a supervisor therefore has no rate yet. That is the
 * honest state: it is zero until the office sets it, and the Workers screen
 * flags it so the office knows to. A supervisor's guess flowing into budget
 * numbers would be worse than a visible gap.
 */

export function isOffice(role: string): boolean {
  return role === 'SUPERADMIN' || role === 'ACCOUNTANT';
}

type WithRate = { hourlyRate?: unknown };

/** Strip the rate from a worker unless the caller is the office. */
export function visibleWorker<T extends WithRate>(worker: T, role: string): T {
  if (isOffice(role)) return worker;
  const { hourlyRate: _rate, ...rest } = worker;
  return rest as T;
}

export function visibleWorkers<T extends WithRate>(workers: T[], role: string): T[] {
  return isOffice(role) ? workers : workers.map((w) => visibleWorker(w, role));
}

type WithCost = { labourCost?: unknown; worker?: WithRate | null };

/**
 * Strip pay from an attendance record: the accrued cost, and the rate on the
 * worker it hangs off.
 */
export function visibleAttendance<T extends WithCost>(record: T, role: string): T {
  if (isOffice(role)) return record;
  const { labourCost: _cost, ...rest } = record;
  return {
    ...rest,
    ...(record.worker ? { worker: visibleWorker(record.worker, role) } : {}),
  } as T;
}

export function visibleAttendanceList<T extends WithCost>(records: T[], role: string): T[] {
  return isOffice(role) ? records : records.map((r) => visibleAttendance(r, role));
}
