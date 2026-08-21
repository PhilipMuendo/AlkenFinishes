import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full text-left text-sm', className)} {...props} />
    </div>
  );
}

/**
 * How much of a row survives on a phone.
 *
 * `overflow-x: auto` on the wrapper used to be the entire mobile strategy, so
 * a payroll row — gross, PAYE, NSSF, SHIF, housing levy, deductions, net —
 * became a sideways swipe with the name scrolling out of view. Marking a
 * column's priority lets the ones that only matter at a desk stand down until
 * there is room for them.
 *
 * - `always` (default): the identifying column and the figure being read.
 * - `sm`: useful, not essential. Hidden below 640px.
 * - `lg`: detail for a desk. Hidden below 1024px.
 *
 * Priority is set once on the `<Th>`; matching `<Td>`s take the same value, so
 * a header and its cells cannot drift apart.
 */
export type ColPriority = 'always' | 'sm' | 'lg';

const PRIORITY: Record<ColPriority, string> = {
  always: '',
  sm: 'hidden sm:table-cell',
  lg: 'hidden lg:table-cell',
};

export function Th({
  className,
  priority = 'always',
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { priority?: ColPriority }) {
  return (
    <th
      className={cn(
        'border-b border-hairline px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle',
        PRIORITY[priority],
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  priority = 'always',
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { priority?: ColPriority }) {
  return (
    <td
      className={cn(
        'border-b border-hairline/70 px-3 py-2.5 text-fg',
        PRIORITY[priority],
        className,
      )}
      {...props}
    />
  );
}

/**
 * "There is nothing here", said the same way everywhere.
 *
 * This used to be wrapped six different ways at the call sites — a bare
 * bordered div, a Card, a Card with p-8, a Card with p-4, a Card with a
 * CardContent, and no wrapper at all — so padding and border weight visibly
 * changed between panels a supervisor moves through in one session. The
 * wrapper now lives here and is chosen by intent, not by className.
 *
 * `boxed` (the default) is a panel's own empty state. `inline` is for an empty
 * region already inside a card — a dialog's history list, a table body.
 */
export function Empty({
  children,
  icon: Icon,
  variant = 'boxed',
}: {
  children: React.ReactNode;
  icon?: LucideIcon;
  variant?: 'boxed' | 'inline';
}) {
  const body = (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center text-sm text-fg-muted',
        variant === 'boxed' ? 'px-6 py-12' : 'py-8',
      )}
    >
      {Icon && (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken text-fg-subtle">
          <Icon size={20} />
        </div>
      )}
      {children}
    </div>
  );

  if (variant === 'inline') return body;
  return <div className="rounded-xl border border-hairline bg-surface shadow-sm">{body}</div>;
}
