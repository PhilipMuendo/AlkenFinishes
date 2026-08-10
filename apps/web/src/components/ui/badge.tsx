import { CheckCircle2, AlertTriangle, AlertOctagon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Health } from '@/lib/types';

export function Badge({
  className,
  tone = 'slate',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: 'slate' | 'green' | 'yellow' | 'red' | 'blue';
}) {
  // Ring-inset tint reads sharper and more considered than a flat fill.
  const tones = {
    slate: 'bg-surface-sunken text-fg-muted ring-hairline-strong/50',
    green: 'bg-good-surface text-good-fg ring-emerald-600/20',
    yellow: 'bg-warn-surface text-warn-fg ring-amber-600/20',
    red: 'bg-danger-surface text-danger-fg ring-red-600/20',
    blue: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Budget health chip — status is conveyed by icon + label, never color alone. */
export function HealthBadge({ health, pct }: { health: Health; pct?: number | null }) {
  if (health === 'NONE') return <Badge>No budget</Badge>;
  const map = {
    GREEN: { tone: 'green' as const, label: 'Healthy', Icon: CheckCircle2 },
    YELLOW: { tone: 'yellow' as const, label: 'Watch', Icon: AlertTriangle },
    RED: { tone: 'red' as const, label: 'At risk', Icon: AlertOctagon },
  };
  const m = map[health];
  return (
    <Badge tone={m.tone}>
      <m.Icon size={12} aria-hidden className="shrink-0" />
      {m.label}
      {pct != null && <span className="nums opacity-80">· {pct}%</span>}
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
  return (
    <Badge tone={tone} className="capitalize">
      {status.replaceAll('_', ' ').toLowerCase()}
    </Badge>
  );
}
