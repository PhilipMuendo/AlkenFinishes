import { Children, cloneElement, forwardRef, isValidElement, useId } from 'react';
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

/**
 * A labelled control.
 *
 * The label and the control are siblings, so the association has to be made
 * explicitly: without it the label is decoration — a screen reader announces
 * the field as blank, and tapping the label does not focus it, which on a
 * phone is a miss every time. So `Field` mints an id, points the label at it,
 * and clones it onto whichever child is the control. `hint` is wired up the
 * same way, so it is read out with the field rather than stranded after it.
 *
 * A child that already carries an `id` keeps its own — this never overwrites
 * a caller who wired it up themselves.
 */
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
  const id = useId();
  const hintId = `${id}-hint`;

  // Only the first element child is treated as the control; anything else
  // (a wrapper with two inputs, say) is left exactly as it was passed.
  let wired = false;
  const controls = Children.map(children, (child) => {
    if (wired || !isValidElement(child)) return child;
    wired = true;
    const props = child.props as { id?: string; 'aria-describedby'?: string };
    return cloneElement(child as React.ReactElement<Record<string, unknown>>, {
      id: props.id ?? id,
      'aria-describedby': hint ? (props['aria-describedby'] ?? hintId) : props['aria-describedby'],
    });
  });

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {controls}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-fg-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}
