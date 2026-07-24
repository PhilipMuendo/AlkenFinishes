import { cn } from '@/lib/utils';

/** Brand wordmark: navy "Alken" + orange "Decor", matching the logo. */
export function Wordmark({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    <span className={cn('font-semibold tracking-tight', className)}>
      <span className={onDark ? 'text-white' : 'text-fg'}>Alken</span>{' '}
      <span className="text-accent-500">Decor</span>
    </span>
  );
}
