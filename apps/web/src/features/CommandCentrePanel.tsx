import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertOctagon,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileSignature,
  HardHat,
  Image as ImageIcon,
  Info,
  Lightbulb,
  Package,
  Receipt,
  ShieldAlert,
  TrendingUp,
  Wallet,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import type { CommandCentreData, Health, Insight, InsightSeverity } from '@/lib/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Badge, HealthBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Mission control for one project.
 *
 * Every card is a summary of a tab that owns the underlying data, and links
 * there — nothing here is a second place any of it lives. Money cards are
 * absent for a supervisor because the server never sends them, so this file
 * branches on `canSeeMoney` rather than on a zero.
 */

// ---------------------------------------------------------------------------
// Card chrome
// ---------------------------------------------------------------------------

function Panel({
  n,
  title,
  icon: Icon,
  to,
  linkLabel,
  children,
  className,
}: {
  n: number;
  title: string;
  icon: LucideIcon;
  to?: string;
  linkLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col p-4', className)}>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-[11px] font-semibold tabular-nums text-fg-subtle">
          {n}
        </span>
        <Icon size={15} className="shrink-0 text-brand-600" />
        <h3 className="truncate text-sm font-semibold text-fg">{title}</h3>
      </div>
      <div className="flex-1">{children}</div>
      {to && (
        <Link
          to={to}
          className="mt-3 inline-flex text-xs font-medium text-brand-700 transition-colors hover:text-brand-800"
        >
          {linkLabel ?? 'View'} &rarr;
        </Link>
      )}
    </Card>
  );
}

/** A label/value row — the shape most of these cards reduce to. */
function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  const toneClass =
    tone === 'bad'
      ? 'text-red-600'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'good'
          ? 'text-emerald-600'
          : 'text-fg';
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
      <span className="truncate text-fg-muted">{label}</span>
      <span className={cn('shrink-0 font-medium tabular-nums', toneClass)}>{value}</span>
    </div>
  );
}

function Big({ value, sub }: { value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <p className="text-2xl font-semibold tabular-nums text-fg">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-fg-subtle">{sub}</p>}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-fg-subtle">{children}</p>;
}

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

// ---------------------------------------------------------------------------

export function CommandCentrePanel({
  projectId,
  /**
   * Supervisors reach each area through the tile grid below this panel, and
   * the admin routes these cards link to are not theirs to visit — so their
   * cards are read-only summaries with no "view" links at all.
   */
  linked = true,
}: {
  projectId: string;
  linked?: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['command-centre', projectId],
    queryFn: () => api<CommandCentreData>(`/projects/${projectId}/command-centre`),
  });

  if (isLoading || !data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const {
    canSeeMoney,
    programme,
    attendance,
    snags,
    equipment,
    safety,
    photos,
    insights,
    pendingApprovals,
    upcomingEvents,
    materials,
    profit,
    invoices,
    financials,
    contractLinked,
  } = data;

  // `undefined` makes Panel drop its footer link entirely.
  const href = (path: string) => (linked ? path : undefined);
  const tabHref = (tab: string) => href(`/admin/projects/${projectId}?tab=${tab}`);
  const totalPending =
    pendingApprovals.expenses + pendingApprovals.materialRequests + pendingApprovals.attendanceOverrides;

  // Cards are numbered to match the agreed layout, and keep their number even
  // when a card is hidden — the numbering describes the design, not the array.
  let n = 0;
  const next = () => (n += 1);

  return (
    <div className="space-y-4">
      {/* A site with no contract behind it is missing the commercial half of
          the system and otherwise gives no sign of it — you would find out
          weeks later, at the claim screen. */}
      {contractLinked === false && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm sm:flex-row sm:items-start dark:border-amber-800 dark:bg-amber-950/40">
          <FileSignature size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-fg">This site has no contract behind it</p>
            <p className="mt-0.5 text-fg-muted">
              Progress claims, retention, the defects liability period and the contract position
              all read through a contract. Until one is linked, this site can be run and costed but
              not claimed against.
            </p>
            {linked && (
              <Link
                to="/admin/contracts"
                className="mt-1.5 inline-block font-medium text-brand-700 hover:underline"
              >
                Link a contract →
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* 1 — Progress against programme */}
        <Panel n={next()} title="Progress against programme" icon={TrendingUp} to={tabHref('tasks')} linkLabel="View programme">
          <Big
            value={`${programme.actualPct}%`}
            sub={
              programme.taskCount === 0
                ? 'No tasks yet'
                : programme.weighted
                  ? 'Weighted by task size'
                  : 'Every task counted equally'
            }
          />
          <Progress value={programme.actualPct} className="my-2.5" />
          <Row label="Planned" value={programme.plannedPct != null ? `${programme.plannedPct}%` : '—'} />
          <Row label="Actual" value={`${programme.actualPct}%`} />
          <div className="mt-2">
            {programme.slipDays == null ? (
              <Muted>Too early in the programme to project a finish date.</Muted>
            ) : programme.slipDays > 0 ? (
              <Badge tone="red">Behind by {programme.slipDays}d</Badge>
            ) : programme.slipDays < 0 ? (
              <Badge tone="green">Ahead by {Math.abs(programme.slipDays)}d</Badge>
            ) : (
              <Badge tone="green">On programme</Badge>
            )}
            {programme.unweightedTaskCount > 0 && (
              <p className="mt-1.5 text-xs text-amber-700">
                {programme.unweightedTaskCount} of {programme.taskCount} tasks have no size set
              </p>
            )}
          </div>
        </Panel>

        {/* 2 — Today's attendance */}
        <Panel n={next()} title="Today's attendance" icon={HardHat} to={tabHref('attendance')} linkLabel="View attendance">
          <div className="grid grid-cols-4 gap-1.5 text-center">
            {[
              { label: 'Workers', value: attendance.assignedWorkers, cls: 'text-fg' },
              { label: 'Present', value: attendance.checkedInToday, cls: 'text-fg' },
              { label: 'Late', value: attendance.late, cls: attendance.late > 0 ? 'text-amber-700' : 'text-fg-subtle' },
              {
                label: 'Absent',
                value: attendance.absent ?? '—',
                cls: attendance.absent ? 'text-red-600' : 'text-fg-subtle',
              },
            ].map((c) => (
              <div key={c.label} className="rounded-lg bg-surface-sunken px-1 py-2">
                <p className={cn('text-lg font-semibold tabular-nums', c.cls)}>{c.value}</p>
                <p className="text-[11px] text-fg-subtle">{c.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-center">
            <div className="rounded-lg border border-hairline px-1 py-1.5">
              <p className="text-[11px] text-fg-subtle">First in</p>
              <p className="text-sm font-medium tabular-nums text-fg">{time(attendance.firstCheckIn)}</p>
            </div>
            <div className="rounded-lg border border-hairline px-1 py-1.5">
              <p className="text-[11px] text-fg-subtle">Last out</p>
              <p className="text-sm font-medium tabular-nums text-fg">{time(attendance.lastCheckOut)}</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-fg-subtle">Day starts {attendance.dayStart}</p>
        </Panel>

        {/* 3 — Materials consumed vs budget (money) */}
        {canSeeMoney && (
          <Panel n={next()} title="Materials vs budget" icon={Package} to={tabHref('stock')} linkLabel="View materials">
            {materials && materials.allocated > 0 ? (
              <>
                <Big
                  value={materials.consumedPct != null ? `${materials.consumedPct}%` : '—'}
                  sub="Of the materials budget"
                />
                <Progress value={materials.consumedPct ?? 0} health={materials.health as Health} className="my-2.5" />
                <Row label="Consumed" value={fmtMoney(materials.actual)} />
                <Row label="Budget" value={fmtMoney(materials.allocated)} />
                <Row
                  label="Remaining"
                  value={fmtMoney(materials.remaining)}
                  tone={materials.remaining < 0 ? 'bad' : 'default'}
                />
              </>
            ) : (
              <Muted>No materials budget has been allocated for this site.</Muted>
            )}
          </Panel>
        )}

        {/* 4 — Budget spent vs remaining (money) */}
        {canSeeMoney && financials && (
          <Panel n={next()} title="Budget spent vs remaining" icon={Wallet} to={tabHref('budget')} linkLabel="View budget">
            <Big
              value={financials.overallConsumedPct != null ? `${financials.overallConsumedPct}%` : '—'}
              sub={<HealthBadge health={financials.overallHealth} />}
            />
            <Progress
              value={financials.overallConsumedPct ?? 0}
              health={financials.overallHealth}
              className="my-2.5"
            />
            <Row label="Total budget" value={fmtMoney(financials.totalBudget)} />
            <Row label="Total spent" value={fmtMoney(financials.totalActual)} tone="bad" />
            <Row
              label="Remaining"
              value={fmtMoney(financials.totalRemaining)}
              tone={financials.totalRemaining < 0 ? 'bad' : 'good'}
            />
          </Panel>
        )}

        {/* 5 — Profit to date (money) */}
        {canSeeMoney && profit && (
          <Panel n={next()} title="Profit to date" icon={TrendingUp} to={tabHref('financials')} linkLabel="View P&L">
            <Big
              value={fmtMoney(profit.grossProfit)}
              sub={profit.marginPct != null ? `${profit.marginPct}% margin` : 'Margin not yet meaningful'}
            />
            <div className="mt-2.5">
              <Row label="Revenue earned" value={fmtMoney(profit.revenueEarned)} />
              <Row label="Total cost" value={fmtMoney(profit.totalCost)} tone="bad" />
              <Row
                label="Gross profit"
                value={fmtMoney(profit.grossProfit)}
                tone={profit.grossProfit < 0 ? 'bad' : 'good'}
              />
            </div>
          </Panel>
        )}

        {/* 6 — Outstanding invoices (money) */}
        {canSeeMoney && invoices && (
          <Panel n={next()} title="Outstanding invoices" icon={Receipt} to={tabHref('invoices')} linkLabel="View invoices">
            <Big
              value={fmtMoney(invoices.outstanding)}
              sub={invoices.overdueCount > 0 ? `${invoices.overdueCount} overdue` : 'Nothing overdue'}
            />
            <div className="mt-2.5">
              <Row label="Total invoiced" value={fmtMoney(invoices.invoiced)} />
              <Row label="Total paid" value={fmtMoney(invoices.collected)} tone="good" />
              <Row
                label="Overdue"
                value={fmtMoney(invoices.overdue)}
                tone={invoices.overdue > 0 ? 'bad' : 'default'}
              />
              {invoices.retentionHeld > 0 && (
                <Row label="Retention held" value={fmtMoney(invoices.retentionHeld)} />
              )}
            </div>
          </Panel>
        )}

        {/* 7 — Daily photos */}
        <Panel n={next()} title="Site photos" icon={ImageIcon} to={tabHref('documents')} linkLabel="View all photos">
          {photos.length === 0 ? (
            <Muted>No site photos uploaded yet.</Muted>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {photos.slice(0, 4).map((p) => (
                <figure key={p.id} className="relative overflow-hidden rounded-lg bg-surface-sunken">
                  <img
                    src={p.url}
                    alt={p.caption ?? `Site photo from ${fmtDate(p.takenAt)}`}
                    loading="lazy"
                    className="h-20 w-full object-cover"
                  />
                  <figcaption className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {fmtDate(p.takenAt)}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </Panel>

        {/* 8 — Open defects */}
        <Panel n={next()} title="Open defects" icon={AlertOctagon} to={tabHref('snags')} linkLabel="View defects">
          <Big
            value={snags.open}
            sub={snags.overdue > 0 ? `${snags.overdue} past the fix date` : 'None overdue'}
          />
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {(['HIGH', 'MEDIUM', 'LOW'] as const).map((sev) =>
              snags.bySeverity[sev] ? (
                <Badge key={sev} tone={sev === 'HIGH' ? 'red' : sev === 'MEDIUM' ? 'yellow' : 'slate'}>
                  {snags.bySeverity[sev]} {sev.toLowerCase()}
                </Badge>
              ) : null,
            )}
            {snags.open === 0 && <Badge tone="green">All clear</Badge>}
          </div>
          {snags.rework > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              Sent back for rework {snags.rework} {snags.rework === 1 ? 'time' : 'times'}
            </p>
          )}
        </Panel>

        {/* 9 — Equipment status */}
        <Panel n={next()} title="Equipment status" icon={Wrench} to={href('/admin/tools')} linkLabel="View equipment">
          {equipment.total === 0 ? (
            <Muted>No equipment is assigned to this site.</Muted>
          ) : (
            <>
              <Big
                value={`${equipment.active} / ${equipment.total}`}
                sub={equipment.down > 0 ? `${equipment.down} out of service` : 'All in service'}
              />
              <ul className="mt-2.5 space-y-1">
                {equipment.items.slice(0, 4).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-fg">{t.name}</span>
                    <Badge
                      tone={t.status === 'ACTIVE' ? (t.serviceOverdue ? 'yellow' : 'green') : 'red'}
                    >
                      {t.serviceOverdue && t.status === 'ACTIVE' ? 'Service due' : t.status.toLowerCase()}
                    </Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        {/* 10 — Safety */}
        <Panel n={next()} title="Safety" icon={ShieldAlert} to={tabHref('safety')} linkLabel="View safety log">
          <Big
            value={safety.total}
            sub={`Incidents in the last ${safety.windowDays} days`}
          />
          <div className="mt-2.5 space-y-1">
            <Row
              label="Serious"
              value={safety.bySeverity.SERIOUS}
              tone={safety.bySeverity.SERIOUS > 0 ? 'bad' : 'default'}
            />
            <Row
              label="Minor"
              value={safety.bySeverity.MINOR}
              tone={safety.bySeverity.MINOR > 0 ? 'warn' : 'default'}
            />
            <Row label="Near miss" value={safety.bySeverity.NEAR_MISS} />
          </div>
        </Panel>

        {/* 11 — Awaiting a decision */}
        <Panel n={next()} title="Awaiting a decision" icon={ClipboardCheck} to={tabHref('expenses')} linkLabel="View approvals">
          <Big value={totalPending} sub={totalPending === 0 ? 'Nothing pending' : 'Items on your desk'} />
          <div className="mt-2.5">
            <Row label="Expense claims" value={pendingApprovals.expenses} />
            <Row label="Material requests" value={pendingApprovals.materialRequests} />
            <Row label="Attendance overrides" value={pendingApprovals.attendanceOverrides} />
          </div>
        </Panel>

        {/* 12 — Next 14 days */}
        <Panel n={next()} title="Next 14 days" icon={CalendarClock} to={href('/admin/calendar')} linkLabel="View calendar">
          {upcomingEvents.length === 0 ? (
            <Muted>Nothing on the calendar.</Muted>
          ) : (
            <ul className="space-y-1.5">
              {upcomingEvents.slice(0, 5).map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate text-fg">{e.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{fmtDate(e.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* 13 — Insights, full width: it reads across every card above it. */}
      <InsightsPanel n={next()} insights={insights} />
    </div>
  );
}

// ---------------------------------------------------------------------------

const SEVERITY_STYLE: Record<
  InsightSeverity,
  { icon: LucideIcon; chip: string; text: string; label: string }
> = {
  CRITICAL: { icon: AlertOctagon, chip: 'bg-red-50 text-red-600', text: 'text-red-700', label: 'Act now' },
  WARNING: { icon: AlertTriangle, chip: 'bg-amber-50 text-amber-600', text: 'text-amber-800', label: 'Watch' },
  INFO: { icon: Info, chip: 'bg-brand-50 text-brand-600', text: 'text-fg', label: 'Note' },
  GOOD: { icon: CheckCircle2, chip: 'bg-emerald-50 text-emerald-600', text: 'text-fg', label: 'On track' },
};

/**
 * Rule-engine output. Deliberately not styled as a chat bubble: every line is
 * a figure computed from this project's own records, and dressing it up as a
 * conversation would suggest a judgement call that nothing here is making.
 */
function InsightsPanel({ n, insights }: { n: number; insights: Insight[] }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-[11px] font-semibold tabular-nums text-fg-subtle">
          {n}
        </span>
        <Lightbulb size={15} className="shrink-0 text-brand-600" />
        <h3 className="text-sm font-semibold text-fg">Recommendations</h3>
        <Badge tone="blue" className="ml-auto">
          From this site&rsquo;s own figures
        </Badge>
      </div>

      {insights.length === 0 ? (
        <Muted>Nothing to flag — every rule this engine checks came back clean.</Muted>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {insights.map((i) => {
            const s = SEVERITY_STYLE[i.severity];
            const Icon = s.icon;
            return (
              <li key={i.id} className="flex gap-2.5 rounded-lg border border-hairline p-2.5">
                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', s.chip)}>
                  <Icon size={15} />
                </span>
                <div className="min-w-0">
                  <p className={cn('text-sm font-medium', s.text)}>{i.message}</p>
                  {i.action && <p className="mt-0.5 text-xs text-fg-muted">{i.action}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
