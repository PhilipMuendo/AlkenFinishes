import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CategoryFinancials, ExpenseSeriesRow } from '@/lib/types';
import { fmtCompact, fmtMoney } from '@/lib/format';
import { CATEGORY_COLORS, CHART_TEXT, GRID, SERIES, tooltipStyle } from './theme';

const axisProps = {
  tick: { fill: CHART_TEXT, fontSize: 11 },
  axisLine: { stroke: GRID },
  tickLine: false as const,
};

const moneyTick = (v: number) => fmtCompact(v).replace('KES ', '');

/** Monthly spend by category, stacked; 2px white gap between segments. */
export function ExpenseTrendChart({ data }: { data: ExpenseSeriesRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={moneyTick} width={52} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtMoney(Number(v))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {(['MATERIALS', 'LABOUR', 'TRANSPORT', 'OTHER'] as const).map((cat) => (
          <Bar
            key={cat}
            dataKey={cat}
            stackId="spend"
            fill={CATEGORY_COLORS[cat]}
            stroke="#ffffff"
            strokeWidth={2}
            name={cat.charAt(0) + cat.slice(1).toLowerCase()}
            radius={cat === 'OTHER' ? [4, 4, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Budget vs actual per category — grouped bars, one axis. */
export function BudgetVsActualChart({ data }: { data: CategoryFinancials[] }) {
  const rows = data.map((c) => ({
    name: c.category.charAt(0) + c.category.slice(1).toLowerCase(),
    Budget: c.allocated,
    Actual: c.actual,
  }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={moneyTick} width={52} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtMoney(Number(v))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Budget" fill={SERIES.primary} radius={[4, 4, 0, 0]} />
        <Bar dataKey="Actual" fill={SERIES.secondary} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Cumulative cost over time — single series line. */
export function CumulativeCostChart({ data }: { data: ExpenseSeriesRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={moneyTick} width={52} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtMoney(Number(v))} />
        <Line
          type="monotone"
          dataKey="cumulative"
          name="Cumulative spend"
          stroke={SERIES.primary}
          strokeWidth={2}
          dot={{ r: 3, fill: SERIES.primary }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Company spend trend — single series. */
export function SpendTrendChart({ data }: { data: { month: string; total: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={moneyTick} width={52} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtMoney(Number(v))} />
        <Line
          type="monotone"
          dataKey="total"
          name="Monthly spend"
          stroke={SERIES.primary}
          strokeWidth={2}
          dot={{ r: 3, fill: SERIES.primary }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Expense category breakdown — horizontal bars (magnitude, labeled directly). */
export function CategoryBreakdownChart({ data }: { data: CategoryFinancials[] }) {
  const rows = data
    .filter((c) => c.actual > 0)
    .map((c) => ({
      name: c.category.charAt(0) + c.category.slice(1).toLowerCase(),
      value: c.actual,
      fill: CATEGORY_COLORS[c.category],
    }));
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-500">No expenses recorded yet</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 52)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" {...axisProps} tickFormatter={moneyTick} />
        <YAxis type="category" dataKey="name" {...axisProps} width={80} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtMoney(Number(v))} />
        <Bar dataKey="value" name="Spent" radius={[0, 4, 4, 0]} barSize={22}>
          {rows.map((r) => (
            <Cell key={r.name} fill={r.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Progress vs cost consumed per project — grouped %, one axis. */
export function ProgressVsCostChart({
  data,
}: {
  data: { name: string; progressPct: number; consumedPct: number | null }[];
}) {
  const rows = data.map((d) => ({
    name: d.name.length > 14 ? `${d.name.slice(0, 13)}…` : d.name,
    'Progress %': d.progressPct,
    'Budget used %': d.consumedPct ?? 0,
  }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis {...axisProps} unit="%" width={44} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v}%`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Progress %" fill={SERIES.primary} radius={[4, 4, 0, 0]} />
        <Bar dataKey="Budget used %" fill={SERIES.secondary} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
