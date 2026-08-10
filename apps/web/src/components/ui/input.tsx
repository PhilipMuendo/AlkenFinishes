import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * 16px on a phone, 14px from `sm` up.
 *
 * Not a typographic choice. iOS Safari zooms the page in when a focused field
 * is smaller than 16px and does not zoom back out when the field is left, so
 * one tap on a form leaves a supervisor pinched into a magnified layout for
 * the rest of the page. `text-base` on mobile is the whole fix, and it has to
 * be on every control that takes a keyboard.
 */
const FIELD_TEXT = 'text-base sm:text-sm';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-11 w-full rounded-lg border border-hairline-strong bg-surface px-3 text-fg shadow-xs transition-colors placeholder:text-fg-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-50',
        FIELD_TEXT,
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'min-h-[90px] w-full rounded-lg border border-hairline-strong bg-surface p-3 text-fg shadow-xs transition-colors placeholder:text-fg-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30',
      FIELD_TEXT,
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-11 w-full rounded-lg border border-hairline-strong bg-surface px-3 text-fg shadow-xs transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30',
        FIELD_TEXT,
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('mb-1.5 block text-xs font-medium text-fg-muted', className)} {...props} />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** Sits under the control, where it is read after a failed guess rather than before. */
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}
