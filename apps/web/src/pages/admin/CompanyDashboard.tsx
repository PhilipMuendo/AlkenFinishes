import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertOctagon,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileText,
  UserX,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { AttentionDigest, PipelineDigest } from '@/lib/types';
import { fmtMoney } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState } from '@/components/ui/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, focusRing, focusRingOnMuted } from '@/lib/utils';

type Tone = 'red' | 'amber' | 'blue';
type Groups = AttentionDigest['groups'];

/** One rendered line: a project, and the one figure that explains why it is here. */
interface Row {
  id: string;
  name: string;
  detail: string;
}

/**
 * Each section reduces its own slice of the digest to `Row`s.
 *
 * Holding a `rows` closure rather than a `detail(item)` callback is what keeps
 * this typed: every group in the digest carries different fields, so the
 * closure narrows against its own group's shape at the point it is written.
 */
interface Section {
  key: keyof Groups;
  label: string;
  hint: string;
  icon: LucideIcon;
  tone: Tone;
  rows: (groups: Groups) => Row[];
}

// Ordered by urgency: money first, then risk, then operational nudges.
const SECTIONS: Section[] = [
  {
    key: 'paymentOverdue',
    label: 'Payments overdue',
    hint: 'Money owed past the agreed date',
    icon: Clock,
    tone: 'red',
    rows: (g) =>
      g.paymentOverdue.map((i) => ({
        id: i.id,
        name: i.name,
        detail: `${fmtMoney(i.pendingBalance)} · ${i.daysOverdue}d overdue`,
      })),
  },
  {
    key: 'overBudget',
    label: 'Over budget',
    hint: 'Spend has crossed the risk threshold',
    icon: AlertOctagon,
    tone: 'red',
    rows: (g) =>
      g.overBudget.map((i) => ({
        id: i.id,
        name: i.name,
        detail: i.consumedPct != null ? `${i.consumedPct}% of budget used` : 'Over budget',
      })),
  },
  {
    key: 'unassigned',
    label: 'No supervisor',
    hint: 'Active sites without anyone assigned',
    icon: UserX,
    tone: 'amber',
    rows: (g) => g.unassigned.map((i) => ({ id: i.id, name: i.name, detail: 'Assign a supervisor' })),
  },
  {
    key: 'wentQuiet',
    label: 'No recent reports',
    hint: 'Active sites that have gone quiet',
    icon: FileText,
    tone: 'amber',
    rows: (g) =>
      g.wentQuiet.map((i) => ({
        id: i.id,
        name: i.name,
        detail: i.daysSince == null ? 'No reports yet' : `Last report ${i.daysSince}d ago`,
      })),
  },
  {
    key: 'finishingSoon',
    label: 'Finishing soon',
    hint: 'Deadlines within two weeks',
    icon: CalendarClock,
    tone: 'blue',
    rows: (g) =>
      g.finishingSoon.map((i) => ({
        id: i.id,
        name: i.name,
        detail: i.daysLeft === 0 ? 'Due today' : `${i.daysLeft}d to deadline`,
      })),
  },
  {
    key: 'pendingApprovals',
    label: 'Awaiting a decision',
    hint: 'Expense claims, material and attendance requests',
    icon: ClipboardCheck,
    tone: 'amber',
    rows: (g) =>
      g.pendingApprovals.map((i) => ({ id: i.id, name: i.name, detail: `${i.total} pending` })),
  },
];

const toneChip: Record<Tone, string> = {
  red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-600',
  blue: 'bg-brand-50 text-brand-600',
};
const toneText: Record<Tone, string> = {
  red: 'text-red-600',
  amber: 'text-amber-700',
  blue: 'text-brand-600',
};

function AttentionSection({ section, rows }: { section: Section; rows: Row[] }) {
  const { icon: Icon, tone } = section;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${toneChip[tone]}`}>
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">
            {section.label}{' '}
            <span className="nums font-normal text-fg-subtle">({rows.length})</span>
          </p>
          <p className="text-xs text-fg-subtle">{section.hint}</p>
        </div>
      </div>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              to={`/admin/projects/${row.id}`}
              className={cn(
                'flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-sunken',
                focusRing,
              )}
            >
              <span className="truncate text-sm font-medium text-fg">{row.name}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className={`nums text-xs font-medium ${toneText[tone]}`}>
                  {row.detail}
                </span>
                <ChevronRight size={15} className="text-fg-subtle" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="What needs your attention" />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/**
 * The pipeline strip.
 *
 * Sits above the attention digest because it answers a different question:
 * that one is "what is going wrong on site", this one is "what is coming".
 * Each figure is a link, since the only useful response to seeing a number
 * here is to go and look at what is behind it.
 */
function PipelineStrip() {
  const { data } = useQuery({
    queryKey: queryKeys.analytics.pipeline(),
    queryFn: () => api<PipelineDigest>('/analytics/pipeline'),
  });
  if (!data) return null;

  const tiles = [
    { label: 'Leads open', to: '/admin/leads', ...data.openLeads },
    { label: 'Quotes with clients', to: '/admin/quotations', ...data.quotationsAwaitingDecision },
    {
      label: 'Awaiting signature',
      to: '/admin/contracts',
      ...data.contractsAwaitingSignature,
    },
    { label: 'Agreed, not started', to: '/admin/contracts', ...data.contractsWithoutSite },
  ];
  if (tiles.every((t) => t.count === 0)) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <Link
          key={t.label}
          to={t.to}
          className={cn(
            'group rounded-xl border border-hairline bg-surface p-4 transition-colors hover:border-hairline-strong',
            focusRingOnMuted,
          )}
        >
          <p className="text-xs font-medium text-fg-muted">{t.label}</p>
          {/* An empty stage is worth showing — it says the pipeline is dry —
              but it must not pull the eye the way a live figure does. */}
          <p
            className={cn(
              'mt-1 text-2xl font-semibold nums',
              t.count > 0 ? 'text-fg' : 'text-fg-subtle/50',
            )}
          >
            {t.count}
          </p>
          <p className="mt-0.5 text-xs nums text-fg-subtle">
            {t.value > 0 ? fmtMoney(t.value) : '—'}
          </p>
        </Link>
      ))}
    </div>
  );
}

export function CompanyDashboard() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.analytics.attention(),
    queryFn: () => api<AttentionDigest>('/analytics/attention'),
  });

  if (isLoading) return <OverviewSkeleton />;

  if (isError || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description="What needs your attention" />
        <ErrorState
          title="Couldn’t load your overview"
          error={error}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  const active = SECTIONS.map((section) => ({ section, rows: section.rows(data.groups) })).filter(
    (s) => s.rows.length > 0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={`${data.activeCount} active · ${data.portfolioCount} in portfolio`}
        actions={
          <Link
            to="/admin/projects"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            All projects <ArrowRight size={15} />
          </Link>
        }
      />

      <PipelineStrip />

      {data.allClear ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <p className="font-medium text-fg">Everything&rsquo;s on track</p>
              <p className="mt-1 max-w-sm text-sm text-fg-muted">
                No overdue payments, budget risks, or quiet sites right now. New issues will show
                up here the moment they appear.
              </p>
            </div>
            <Link to="/admin/projects" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              View all projects
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {active.map(({ section, rows }) => (
            <AttentionSection key={section.key} section={section} rows={rows} />
          ))}
        </div>
      )}
    </div>
  );
}
