import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import type { CompanyAnalytics } from '@/lib/types';
import { fmtMoney } from '@/lib/format';
import { StatTile } from '@/components/charts/StatTile';
import { ProgressVsCostChart, SpendTrendChart } from '@/components/charts/Charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, HealthBadge, StatusBadge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, Td, Th, Empty } from '@/components/ui/table';

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
        <p className="text-sm text-slate-500">All active projects at a glance</p>
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

      <Card>
        <CardHeader>
          <CardTitle>Project comparison</CardTitle>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <Empty>No projects yet — create one under Projects</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Project</Th>
                  <Th>Status</Th>
                  <Th>Progress</Th>
                  <Th className="text-right">Contract</Th>
                  <Th className="text-right">Spent</Th>
                  <Th className="text-right">Est. profit</Th>
                  <Th>Budget health</Th>
                  <Th>Manual attendance</Th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <Td>
                      <Link
                        to={`/admin/projects/${p.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {p.name}
                      </Link>
                      <p className="text-xs text-slate-500">{p.supervisor?.name ?? 'Unassigned'}</p>
                    </Td>
                    <Td>
                      <StatusBadge status={p.status} />
                    </Td>
                    <Td className="min-w-[120px]">
                      <div className="flex items-center gap-2">
                        <Progress value={p.progressPct} health="GREEN" className="w-20" />
                        <span className="text-xs tabular-nums">{p.progressPct}%</span>
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">{fmtMoney(p.contractValue)}</Td>
                    <Td className="text-right tabular-nums">{fmtMoney(p.totalActual)}</Td>
                    <Td
                      className={`text-right font-medium tabular-nums ${
                        p.estimatedProfit >= 0 ? 'text-green-700' : 'text-red-700'
                      }`}
                    >
                      {fmtMoney(p.estimatedProfit)}
                    </Td>
                    <Td>
                      <HealthBadge health={p.health} pct={p.consumedPct} />
                    </Td>
                    <Td>
                      {p.manualOverrides30d > 0 ? (
                        <Badge tone="yellow">▲ {p.manualOverrides30d} in 30d</Badge>
                      ) : (
                        <span className="text-xs text-slate-400">None</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
