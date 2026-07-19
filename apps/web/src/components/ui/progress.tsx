import { cn } from '@/lib/utils';
import type { Health } from '@/lib/types';

const healthColor: Record<Health, string> = {
  GREEN: 'bg-green-600',
  YELLOW: 'bg-amber-500',
  RED: 'bg-red-600',
  NONE: 'bg-slate-400',
};

export function Progress({
  value,
  health = 'NONE',
  className,
}: {
  value: number; // 0..100+, clamped visually
  health?: Health;
  className?: string;
}) {
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn('h-full rounded-full transition-all', healthColor[health])}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
