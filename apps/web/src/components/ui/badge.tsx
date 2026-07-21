import { cn } from '@/lib/utils';
import type { Health } from '@/lib/types';

export function Badge({
  className,
  tone = 'slate',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: 'slate' | 'green' | 'yellow' | 'red' | 'blue';
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-green-100 text-green-800',
    yellow: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
    blue: 'bg-brand-100 text-brand-700',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Budget health chip — status color is never conveyed by color alone. */
export function HealthBadge({ health, pct }: { health: Health; pct?: number | null }) {
  if (health === 'NONE') return <Badge>No budget</Badge>;
  const map = {
    GREEN: { tone: 'green' as const, label: 'Healthy', icon: '●' },
    YELLOW: { tone: 'yellow' as const, label: 'Watch', icon: '▲' },
    RED: { tone: 'red' as const, label: 'At risk', icon: '■' },
  };
  const m = map[health];
  return (
    <Badge tone={m.tone}>
      <span aria-hidden>{m.icon}</span>
      {m.label}
      {pct != null && <span>· {pct}%</span>}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'ACTIVE' || status === 'DONE' || status === 'COMPLETED'
      ? 'green'
      : status === 'ON_HOLD' || status === 'BLOCKED'
        ? 'yellow'
        : status === 'CANCELLED'
          ? 'red'
          : status === 'IN_PROGRESS'
            ? 'blue'
            : 'slate';
  return <Badge tone={tone}>{status.replaceAll('_', ' ')}</Badge>;
}
