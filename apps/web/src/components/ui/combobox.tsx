import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
}

/**
 * A searchable drop-in replacement for a native <select> with long option
 * lists (fundi/site pickers at 200+ entries). Renders a hidden input so it
 * still participates in a plain `new FormData(form)` submit the same way a
 * <select name="..."> would — callers can swap one for the other directly.
 */
export function Combobox({
  name,
  options,
  value: controlledValue,
  defaultValue,
  onChange,
  placeholder = 'Select…',
  emptyText = 'No matches',
  className,
  'aria-label': ariaLabel,
}: {
  name?: string;
  options: ComboboxOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const isControlled = controlledValue !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? '');
  const value = isControlled ? controlledValue : internalValue;
  const selected = options.find((o) => o.value === value) ?? null;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selected?.label ?? '');
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the visible text in sync when the selection changes from outside
  // (a controlled parent, or the option list finishing its initial load).
  useEffect(() => {
    setQuery(selected?.label ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, selected?.label]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q === selected?.label.toLowerCase()) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, selected]);

  function selectOption(next: ComboboxOption) {
    if (!isControlled) setInternalValue(next.value);
    onChange?.(next.value);
    setQuery(next.label);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      {name && <input type="hidden" name={name} value={value} />}
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) {
              if (!isControlled) setInternalValue('');
              onChange?.('');
            }
          }}
          placeholder={placeholder}
          className={cn(
            'h-11 w-full rounded-lg border border-hairline-strong bg-surface px-3 pr-8 text-sm text-fg shadow-xs transition-colors placeholder:text-fg-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30',
            className,
          )}
        />
        <ChevronsUpDown
          size={14}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle"
        />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-hairline bg-surface py-1 shadow-md">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-fg-subtle">{emptyText}</p>
          ) : (
            filtered.map((o) => (
              <button
                type="button"
                key={o.value}
                onClick={() => selectOption(o)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-surface-sunken"
              >
                {o.label}
                {o.value === value && <Check size={14} className="shrink-0 text-brand-600" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
