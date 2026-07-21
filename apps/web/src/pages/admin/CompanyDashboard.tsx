import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CompanyAnalytics, ProjectStatus } from '@/lib/types';
import { fmtMoney } from '@/lib/format';
import { StatTile } from '@/components/charts/StatTile';
import { ProgressVsCostChart, SpendTrendChart } from '@/components/charts/Charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, HealthBadge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/table';
import { ProjectCard } from '@/components/ProjectCard';

const SECTIONS: { key: ProjectStatus; label: string }[] = [
  { key: 'PLANNING', label: 'About to start' },
  { key: 'ACTIVE', label: 'Ongoing' },
  { key: 'ON_HOLD', label: 'On hold' },
  { key: 'COMPLETED', label: 'Completed' },
];

export function CompanyDashboard() {
  const { data, isError, refetch } = useQuery({
    queryKey: ['analytics', 'company'],
    queryFn: () => api<CompanyAnalytics>('/analytics/company'),
  });

  if (isError) {
    return (
      <p className="text-sm text-red-600">
        Failed to load the dashboard.{' '}
        <button className="underline" onClick={() => void refetch()}>
          Retry
        </button>
      </p>
    );
  }
  if (!data) return <p className="text-sm text-slate-500">Loading dashboard…</p>;
  const { totals, projects, spendTrend } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Company Dashboard</h1>
        <p className="text-sm text-slate-500">Your portfolio at a glance</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total contract value" value={fmtMoney(totals.contractValue)} />
        <StatTile label="Total expenses" value={fmtMoney(totals.totalActual)} />
        <StatTile
          label="Estimated profit"
          value={fmtMoney(totals.estimatedProfit)}
          accent={totals.estimatedProfit >= 0 ? 'positive' : 'negative'}
        />
        <StatTile
          label="Budget health"
          value={
            totals.totalBudget > 0
              ? `${Math.round((totals.totalActual / totals.totalBudget) * 100)}%`
              : '—'
          }
          sub={<HealthBadge health={totals.overallHealth} />}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total collected" value={fmtMoney(totals.totalCollected)} />
        <StatTile label="Total pending balance" value={fmtMoney(totals.totalPendingBalance)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Company spend trend</CardTitle>
          </CardHeader>
          <CardContent>
            {spendTrend.length ? (
              <SpendTrendChart data={spendTrend} />
            ) : (
              <Empty>No expenses recorded yet</Empty>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Progress vs budget used</CardTitle>
          </CardHeader>
          <CardContent>
            {projects.length ? (
              <ProgressVsCostChart data={projects} />
            ) : (
              <Empty>No projects yet</Empty>
            )}
          </CardContent>
        </Card>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="pt-5">
            <Empty>No projects yet — create one under Projects</Empty>
          </CardContent>
        </Card>
      ) : (
        SECTIONS.map(({ key, label }) => {
          const group = projects.filter((p) => p.status === key);
          return (
            <Card key={key}>
              <CardHeader>
                <CardTitle>
                  {label} ({group.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {group.length === 0 ? (
                  <Empty>No projects in this stage</Empty>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {group.map((p) => (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        extra={
                          <div className="mt-2 space-y-1 text-xs">
                            <div className="flex items-center justify-between">
                              <span>Collected: {fmtMoney(p.totalCollected)}</span>
                              <HealthBadge health={p.health} pct={p.consumedPct} />
                            </div>
                            {p.manualOverrides30d > 0 && (
                              <Badge tone="yellow">▲ {p.manualOverrides30d} manual in 30d</Badge>
                            )}
                          </div>
                        }
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
