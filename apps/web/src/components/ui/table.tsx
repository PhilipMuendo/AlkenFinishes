import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full text-left text-sm', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'border-b border-hairline px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('border-b border-hairline/70 px-3 py-2.5 text-fg', className)}
      {...props}
    />
  );
}

export function Empty({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-fg-muted">
      {Icon && (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken text-fg-subtle">
          <Icon size={20} />
        </div>
      )}
      {children}
    </div>
  );
}
