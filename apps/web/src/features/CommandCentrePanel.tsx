import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertOctagon,
  CalendarClock,
  ClipboardCheck,
  Fingerprint,
  ScrollText,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { CommandCentreData } from '@/lib/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Badge, HealthBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-fg-subtle">{sub}</p>}
    </Card>
  );
}

/**
 * Mission control for one project: the figures and open items that would
 * otherwise take ten tab visits to piece together, in one screen. Every tile
 * links through to the tab that owns the underlying data — this is a summary,
 * not a second place any of it lives.
 */
export function CommandCentrePanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['command-centre', projectId],
    queryFn: () => api<CommandCentreData>(`/projects/${projectId}/command-centre`),
  });

  if (isLoading || !data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const { financials, contractPosition, latestDailyReport, snags, pendingApprovals, upcomingEvents, attendance } = data;
  const totalPending = pendingApprovals.expenses + pendingApprovals.materialRequests + pendingApprovals.attendanceOverrides;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Estimated profit"
          value={fmtMoney(financials.estimatedProfit)}
          sub={<HealthBadge health={financials.overallHealth} pct={financials.overallConsumedPct ?? undefined} />}
        />
        <Tile
          label="On site today"
          value={`${attendance.checkedInToday} / ${attendance.assignedWorkers}`}
          sub={attendance.stillOpen > 0 ? `${attendance.stillOpen} still clocked in` : 'All checked out'}
        />
        <Tile
          label="Open defects"
          value={snags.open}
          sub={snags.overdue > 0 ? `${snags.overdue} past due` : 'None overdue'}
        />
        <Tile
          label="Awaiting a decision"
          value={totalPending}
          sub={
            totalPending > 0
              ? `${pendingApprovals.expenses} expenses · ${pendingApprovals.materialRequests} materials · ${pendingApprovals.attendanceOverrides} attendance`
              : 'Nothing pending'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {contractPosition && (
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <ScrollText size={16} className="text-brand-600" />
              <p className="text-sm font-semibold text-fg">Contract position</p>
            </div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-fg-muted">Current sum, excl. VAT</dt>
                <dd className="tabular-nums text-fg">{fmtMoney(contractPosition.currentValue)}</dd>
              </div>
              {contractPosition.pendingVariations !== 0 && (
                <div className="flex justify-between text-amber-700">
                  <dt>Variations pending</dt>
                  <dd className="tabular-nums">{fmtMoney(contractPosition.pendingVariations)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-fg-muted">Retention held over the job</dt>
                <dd className="tabular-nums text-fg">{fmtMoney(contractPosition.retentionAmount)}</dd>
              </div>
            </dl>
          </Card>
        )}

        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <Fingerprint size={16} className="text-brand-600" />
            <p className="text-sm font-semibold text-fg">Latest site update</p>
          </div>
          {latestDailyReport ? (
            <p className="text-sm text-fg">
              {fmtDate(latestDailyReport.date)} · {latestDailyReport.workersPresent} workers present
            </p>
          ) : (
            <p className="text-sm text-fg-subtle">No daily report submitted yet</p>
          )}
        </Card>

        {snags.open > 0 && (
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <AlertOctagon size={16} className="text-brand-600" />
              <p className="text-sm font-semibold text-fg">Open defects by severity</p>
            </div>
            <div className="flex gap-2">
              {(['HIGH', 'MEDIUM', 'LOW'] as const).map((sev) =>
                snags.bySeverity[sev] ? (
                  <Badge key={sev} tone={sev === 'HIGH' ? 'red' : sev === 'MEDIUM' ? 'yellow' : 'slate'}>
                    {snags.bySeverity[sev]} {sev.toLowerCase()}
                  </Badge>
                ) : null,
              )}
            </div>
          </Card>
        )}

        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <CalendarClock size={16} className="text-brand-600" />
            <p className="text-sm font-semibold text-fg">Next 14 days</p>
          </div>
          {upcomingEvents.length === 0 ? (
            <p className="text-sm text-fg-subtle">Nothing on the calendar</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {upcomingEvents.map((e) => (
                <li key={e.id} className="flex justify-between gap-2">
                  <span className="text-fg">{e.title}</span>
                  <span className="shrink-0 text-fg-subtle">{fmtDate(e.date)}</span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/admin/calendar" className="mt-2 inline-block text-xs text-brand-700 underline">
            View calendar
          </Link>
        </Card>
      </div>

      {totalPending > 0 && (
        <Card className="flex items-center gap-2 border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <ClipboardCheck size={16} className="shrink-0" />
          {totalPending} item{totalPending > 1 ? 's' : ''} on this site {totalPending > 1 ? 'are' : 'is'} waiting
          on you — check Expenses, Stock or Attendance.
        </Card>
      )}
    </div>
  );
}
