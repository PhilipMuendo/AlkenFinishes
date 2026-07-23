import { cn } from '@/lib/utils';
import type { Health } from '@/lib/types';

const healthColor: Record<Health, string> = {
  GREEN: 'bg-emerald-500',
  YELLOW: 'bg-amber-500',
  RED: 'bg-red-500',
  NONE: 'bg-slate-300',
};

export function Progress({
  value,
  health,
  className,
}: {
  value: number; // 0..100+, clamped visually
  // Omit for a neutral completion bar; pass a Health to convey budget state.
  health?: Health;
  className?: string;
}) {
  const fill = health ? healthColor[health] : 'bg-brand-500';
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken', className)}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn('h-full rounded-full transition-all duration-500', fill)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
