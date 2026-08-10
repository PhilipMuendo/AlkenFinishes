import type { LucideIcon } from 'lucide-react';
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
  icon?: LucideIcon;
}) {
  return (
    <Card className="p-4 transition-shadow hover:shadow-md sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
        {Icon && (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-fg-subtle">
            <Icon size={16} />
          </div>
        )}
      </div>
      <p
        className={cn(
          'nums mt-2 text-2xl font-semibold tracking-tight text-fg',
          accent === 'positive' && 'text-good-fg',
          accent === 'negative' && 'text-danger-fg',
        )}
      >
        {value}
      </p>
      {sub && <div className="mt-1 text-xs text-fg-muted">{sub}</div>}
    </Card>
  );
}
