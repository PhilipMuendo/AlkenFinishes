import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function StatTile({
  label,
  value,
  sub,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  accent?: 'default' | 'positive' | 'negative';
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <Card className="p-4 transition-shadow hover:shadow-md sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
        {Icon && (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon size={16} />
          </div>
        )}
      </div>
      <p
        className={cn(
          'nums mt-2 text-2xl font-semibold tracking-tight text-fg',
          accent === 'positive' && 'text-emerald-700',
          accent === 'negative' && 'text-red-700',
        )}
      >
        {value}
      </p>
      {sub && <div className="mt-1 text-xs text-fg-muted">{sub}</div>}
    </Card>
  );
}
