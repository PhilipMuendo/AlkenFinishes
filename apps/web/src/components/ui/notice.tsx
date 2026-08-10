import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A tinted panel that says something the user needs to weigh before acting:
 * a VAT figure that does not add up, tax about to be withheld, a supplier the
 * system could not match.
 *
 * This exists because the same three classes were written out by hand in a
 * dozen places, which is how half of them ended up with dark-mode variants and
 * half without. One component, one set of tokens.
 *
 * `as="label"` is for the panels that wrap a checkbox — several of these ask
 * for a decision rather than just stating one, and the whole panel should be
 * the click target.
 */
export type Tone = 'warn' | 'danger' | 'good' | 'info';

const toneClass: Record<Tone, string> = {
  warn: 'border-warn-hairline bg-warn-surface text-warn-fg',
  danger: 'border-danger-hairline bg-danger-surface text-danger-fg',
  good: 'border-good-hairline bg-good-surface text-good-fg',
  info: 'border-info-hairline bg-info-surface text-info-fg',
};

export function Notice({
  tone = 'warn',
  icon: Icon,
  as: Tag = 'div',
  className,
  children,
  ...props
}: {
  tone?: Tone;
  icon?: LucideIcon;
  as?: 'div' | 'label' | 'p';
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cn('flex gap-2.5 rounded-lg border p-3 text-sm', toneClass[tone], className)}
      {...props}
    >
      {Icon && <Icon size={18} className="mt-0.5 shrink-0" />}
      {Icon ? <span className="min-w-0 flex-1">{children}</span> : children}
    </Tag>
  );
}
