import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, Banknote, Building2, Clock, TrendingUp, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import type { CompanyAnalytics, ProjectStatus } from '@/lib/types';
import { fmtMoney } from '@/lib/format';
import { StatTile } from '@/components/charts/StatTile';
import { ProgressVsCostChart, SpendTrendChart } from '@/components/charts/Charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { HealthBadge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { ProjectCard } from '@/components/ProjectCard';

const SECTIONS: { key: ProjectStatus; label: string; hint: string }[] = [
  { key: 'ACTIVE', label: 'Ongoing', hint: 'Live sites in progress' },
  { key: 'PLANNING', label: 'About to start', hint: 'Awaiting kickoff' },
  { key: 'ON_HOLD', label: 'On hold', hint: 'Paused sites' },
  { key: 'COMPLETED', label: 'Completed', hint: 'Delivered projects' },
];

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <PageHeader title="Overview" description="Portfolio performance at a glance" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-28" />
            <Skeleton className="mt-2 h-3 w-16" />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function CompanyDashboard() {
  const { data, isError, isLoading, refetch } = useQuery({
    queryKey: ['analytics', 'company'],
    queryFn: () => api<CompanyAnalytics>('/analytics/company'),
  });

  if (isLoading) return <DashboardSkeleton />;

  if (isError || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description="Portfolio performance at a glance" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle size={20} />
            </div>
            <div>
              <p className="font-medium text-fg">Couldn&rsquo;t load the dashboard</p>
              <p className="mt-1 text-sm text-fg-muted">
                Check your connection and try again.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { totals, projects, spendTrend } = data;
  const marginPct =
    totals.contractValue > 0
      ? Math.round((totals.estimatedProfit / totals.contractValue) * 100)
      : null;
  const collectedPct =
    totals.contractValue > 0
      ? Math.round((totals.totalCollected / totals.contractValue) * 100)
      : null;
  const atRisk = projects.filter((p) => p.health === 'RED').length;
  const activeCount = projects.filter((p) => p.status === 'ACTIVE').length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description={`${activeCount} active ${activeCount === 1 ? 'project' : 'projects'} · ${projects.length} in portfolio`}
      />

      {/* Four numbers an owner actually acts on: what's owed, what's in, what's left, what's earned. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Contract value"
          value={fmtMoney(totals.contractValue)}
          sub="Total signed"
          icon={Building2}
        />
        <StatTile
          label="Collected"
          value={fmtMoney(totals.totalCollected)}
          sub={collectedPct != null ? `${collectedPct}% of contracts` : undefined}
          icon={Banknote}
        />
        <StatTile
          label="Outstanding"
          value={fmtMoney(totals.totalPendingBalance)}
          sub="Awaiting payment"
          accent={totals.totalPendingBalance > 0 ? 'negative' : 'default'}
          icon={Clock}
        />
        <StatTile
          label="Est. profit"
          value={fmtMoney(totals.estimatedProfit)}
          sub={
            <span className="flex items-center gap-1.5">
              {marginPct != null && <span className="nums">{marginPct}% margin</span>}
              <HealthBadge health={totals.overallHealth} />
            </span>
          }
          accent={totals.estimatedProfit >= 0 ? 'positive' : 'negative'}
          icon={Wallet}
        />
      </div>

      {atRisk > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <span className="font-medium text-amber-900">
              {atRisk} {atRisk === 1 ? 'project is' : 'projects are'} over budget.
            </span>{' '}
            <span className="text-amber-800">Review spending before it erodes margin.</span>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Spend trend</CardTitle>
            <p className="text-xs text-fg-muted">Monthly cost across all sites</p>
          </CardHeader>
          <CardContent>
            {spendTrend.length ? (
              <SpendTrendChart data={spendTrend} />
            ) : (
              <Empty icon={TrendingUp}>No spend recorded yet</Empty>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Progress vs. budget used</CardTitle>
            <p className="text-xs text-fg-muted">Sites spending faster than they build</p>
          </CardHeader>
          <CardContent>
            {projects.length ? (
              <ProgressVsCostChart data={projects} />
            ) : (
              <Empty icon={Building2}>No projects yet</Empty>
            )}
          </CardContent>
        </Card>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent>
            <Empty icon={Building2}>
              <p className="font-medium text-fg">No projects yet</p>
              <p className="mt-1 max-w-xs text-fg-muted">
                Create your first project to start tracking budgets, payments, and progress.
              </p>
              <Link to="/admin/projects" className={buttonVariants({ className: 'mt-3' })}>
                Create a project
              </Link>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {SECTIONS.map(({ key, label, hint }) => {
            const group = projects.filter((p) => p.status === key);
            if (group.length === 0) return null;
            return (
              <section key={key}>
                <div className="mb-3 flex items-baseline gap-2.5">
                  <h2 className="text-sm font-semibold tracking-tight text-fg">{label}</h2>
                  <span className="nums rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-fg-muted">
                    {group.length}
                  </span>
                  <span className="text-xs text-fg-subtle">{hint}</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.map((p) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      extra={
                        <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3 text-xs">
                          <span className="text-fg-muted">
                            Collected{' '}
                            <span className="nums font-medium text-fg">{fmtMoney(p.totalCollected)}</span>
                          </span>
                          <HealthBadge health={p.health} pct={p.consumedPct} />
                        </div>
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
