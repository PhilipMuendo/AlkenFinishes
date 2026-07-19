import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  accent?: 'default' | 'positive' | 'negative';
}) {
  return (
    <Card className="p-4 sm:p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums text-slate-900',
          accent === 'positive' && 'text-green-700',
          accent === 'negative' && 'text-red-700',
        )}
      >
        {value}
      </p>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </Card>
  );
}
