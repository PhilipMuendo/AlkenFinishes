import { createContext, forwardRef, useContext, useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * Wiring a `<Field>` to the control inside it.
 *
 * The label and the control are siblings, not nested, so the association has
 * to be made by id. Passing that id down by context rather than by
 * `cloneElement` means it survives a control wrapped in a div, and means a
 * caller who sets an explicit `id` still wins.
 *
 * Every `<Field>` in this app holds exactly one control; two would both claim
 * the same id, which is why `Field` is the only thing that provides this.
 */
interface FieldWiring {
  id: string;
  describedBy?: string;
}
const FieldContext = createContext<FieldWiring | null>(null);

/**
 * Returns the `id` / `aria-describedby` a labelled control should carry.
 * Exposed because `Combobox` renders its own input and needs the same wiring.
 */
export function useFieldWiring(ownId?: string, ownDescribedBy?: string) {
  const field = useContext(FieldContext);
  return {
    id: ownId ?? field?.id,
    'aria-describedby': ownDescribedBy ?? field?.describedBy,
  };
}

const controlBase =
  'w-full rounded-lg border border-hairline-strong bg-surface text-sm text-fg shadow-xs transition-colors placeholder:text-fg-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, id, 'aria-describedby': describedBy, ...props }, ref) => {
    const wiring = useFieldWiring(id, describedBy);
    return (
      <input ref={ref} {...wiring} className={cn(controlBase, 'h-11 px-3', className)} {...props} />
    );
  },
);
Input.displayName = 'Input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, id, 'aria-describedby': describedBy, ...props }, ref) => {
  const wiring = useFieldWiring(id, describedBy);
  return (
    <textarea
      ref={ref}
      {...wiring}
      className={cn(controlBase, 'min-h-[90px] p-3', className)}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, id, 'aria-describedby': describedBy, ...props }, ref) => {
    const wiring = useFieldWiring(id, describedBy);
    return (
      <select
        ref={ref}
        {...wiring}
        className={cn(controlBase, 'h-11 px-3', className)}
        {...props}
      />
    );
  },
);
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  // `htmlFor` arrives through the props spread — `Field` always supplies it,
  // and the rule is enforced at the call sites that matter.
  return (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
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
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <FieldContext.Provider value={{ id, describedBy: hintId }}>
      <div>
        <Label htmlFor={id}>{label}</Label>
        {children}
        {hint && (
          <p id={hintId} className="mt-1 text-xs text-fg-subtle">
            {hint}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
