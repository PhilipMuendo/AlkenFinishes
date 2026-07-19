import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ProjectAnalytics } from '@/lib/types';
import { fmtMoney } from '@/lib/format';
import { StatTile } from '@/components/charts/StatTile';
import {
  BudgetVsActualChart,
  CategoryBreakdownChart,
  CumulativeCostChart,
  ExpenseTrendChart,
} from '@/components/charts/Charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HealthBadge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Empty } from '@/components/ui/table';

export function FinancialsPanel({ projectId }: { projectId: string }) {
  const { data } = useQuery({
    queryKey: ['analytics', 'project', projectId],
    queryFn: () => api<ProjectAnalytics>(`/analytics/projects/${projectId}`),
  });
  if (!data) return <p className="text-sm text-slate-500">Loading financials…</p>;
  const { financials: fin, expenseSeries } = data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Contract value" value={fmtMoney(fin.contractValue)} />
        <StatTile label="Total expenses" value={fmtMoney(fin.totalActual)} />
        <StatTile
          label="Estimated profit"
          value={fmtMoney(fin.estimatedProfit)}
          accent={fin.estimatedProfit >= 0 ? 'positive' : 'negative'}
          sub="Contract value − actual expenses"
        />
        <StatTile
          label="Budget consumed"
          value={fin.overallConsumedPct != null ? `${fin.overallConsumedPct}%` : '—'}
          sub={<HealthBadge health={fin.overallHealth} />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Budget consumption by category</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {fin.categories.map((c) => (
            <div key={c.category}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium text-slate-800">
                  {c.category.charAt(0) + c.category.slice(1).toLowerCase()}
                </span>
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="tabular-nums">
                    {fmtMoney(c.actual)} / {fmtMoney(c.allocated)}
                  </span>
                  <HealthBadge health={c.health} pct={c.consumedPct} />
                </span>
              </div>
              <Progress value={c.consumedPct ?? 0} health={c.health} />
            </div>
          ))}
          <p className="text-xs text-slate-400">
            Thresholds: Watch at {fin.thresholds.yellowPct}%, At-risk at {fin.thresholds.redPct}%.
            Labour includes biometric attendance cost ({fmtMoney(fin.attendanceLabourCost)}).
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Expense trend</CardTitle>
          </CardHeader>
          <CardContent>
            {expenseSeries.length ? (
              <ExpenseTrendChart data={expenseSeries} />
            ) : (
              <Empty>No expenses yet</Empty>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Budget vs actual</CardTitle>
          </CardHeader>
          <CardContent>
            <BudgetVsActualChart data={fin.categories} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cumulative cost</CardTitle>
          </CardHeader>
          <CardContent>
            {expenseSeries.length ? (
              <CumulativeCostChart data={expenseSeries} />
            ) : (
              <Empty>No expenses yet</Empty>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Category breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryBreakdownChart data={fin.categories} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
