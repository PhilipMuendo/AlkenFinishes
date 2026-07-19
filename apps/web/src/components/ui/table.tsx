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
        'border-b border-slate-200 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('border-b border-slate-100 px-3 py-2.5 text-slate-800', className)}
      {...props}
    />
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-12 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}
