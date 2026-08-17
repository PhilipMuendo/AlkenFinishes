import { CheckCircle2, AlertTriangle, AlertOctagon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { humanizeStatus, type Tone } from '@/lib/tone';
import type { Health } from '@/lib/types';

export function Badge({
  className,
  tone = 'slate',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
}) {
  // Ring-inset tint reads sharper and more considered than a flat fill.
  const tones: Record<Tone, string> = {
    slate: 'bg-surface-sunken text-fg-muted ring-hairline-strong/50',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    yellow: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    red: 'bg-red-50 text-red-700 ring-red-600/20',
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

/**
 * A status chip whose colour comes from the caller's own status map in
 * `lib/tone.ts`.
 *
 * It used to take a bare `string` and guess the colour from a ladder of
 * comparisons (`ACTIVE || DONE || COMPLETED` → green), which silently gave
 * grey to anything it had not been told about. Passing the map in means a new
 * status has to be given a colour before it will compile.
 */
export function StatusBadge<S extends string>({
  status,
  tones,
  className,
}: {
  status: S;
  tones: Record<S, Tone>;
  className?: string;
}) {
  return (
    <Badge tone={tones[status]} className={className}>
      {humanizeStatus(status)}
    </Badge>
  );
}
