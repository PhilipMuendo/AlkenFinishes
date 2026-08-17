import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useFieldWiring } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
}

/**
 * A searchable drop-in replacement for a native <select> with long option
 * lists (worker/site pickers at 200+ entries). Renders a hidden input so it
 * still participates in a plain `new FormData(form)` submit the same way a
 * <select name="..."> would — callers can swap one for the other directly.
 *
 * Follows the ARIA combobox pattern: the input owns a listbox, arrow keys move
 * an active option, Enter takes it and Escape abandons it. Without that, the
 * only way through a 200-entry list was to Tab through every option in turn.
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
  /**
   * What the user has typed, or `null` when they have not typed since the last
   * selection. Deriving the visible text from this instead of mirroring the
   * selected label into state removes the effect that used to resync
   * them — and with it, a render cascade on every parent update.
   */
  const [typed, setTyped] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const wiring = useFieldWiring();

  const query = typed ?? selected?.label ?? '';

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const filtered = useMemo(() => {
    // No filtering until they actually type: opening the list should show
    // everything, not just the one option already chosen.
    const q = (typed ?? '').trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, typed]);

  const clampedActive = Math.min(activeIndex, Math.max(0, filtered.length - 1));

  function selectOption(next: ComboboxOption) {
    if (!isControlled) setInternalValue(next.value);
    onChange?.(next.value);
    setTyped(null);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      setTyped(null);
      return;
    }
    if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault(); // never submit the form while picking
      const option = filtered[clampedActive];
      if (option) selectOption(option);
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
    if (e.key in moves) {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length === 0) return;
      const nextIndex = (clampedActive + moves[e.key] + filtered.length) % filtered.length;
      setActiveIndex(nextIndex);
      return;
    }
    if (e.key === 'Home' && open) {
      e.preventDefault();
      setActiveIndex(0);
    }
    if (e.key === 'End' && open) {
      e.preventDefault();
      setActiveIndex(Math.max(0, filtered.length - 1));
    }
  }

  const activeOptionId = filtered[clampedActive]
    ? `${listboxId}-${filtered[clampedActive].value}`
    : undefined;

  return (
    <div ref={containerRef} className="relative">
      {name && <input type="hidden" name={name} value={value} />}
      <div className="relative">
        <input
          {...wiring}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open ? activeOptionId : undefined}
          aria-label={ariaLabel}
          value={query}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            setTyped(e.target.value);
            setActiveIndex(0);
            setOpen(true);
            // Typing over a chosen value clears it: the field now says
            // something the selection no longer matches.
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
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle"
        />
      </div>
      <ul
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
        className={cn(
          'absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-hairline bg-surface py-1 shadow-md',
          !open && 'hidden',
        )}
      >
        {filtered.length === 0 ? (
          <li className="px-3 py-2 text-sm text-fg-subtle">{emptyText}</li>
        ) : (
          filtered.map((o, i) => (
            <li
              key={o.value}
              id={`${listboxId}-${o.value}`}
              role="option"
              aria-selected={o.value === value}
              // Pointer-down rather than click: the input's blur would
              // otherwise close the list before the click landed.
              onMouseDown={(e) => {
                e.preventDefault();
                selectOption(o);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm text-fg',
                i === clampedActive && 'bg-surface-sunken',
              )}
            >
              {o.label}
              {o.value === value && <Check size={14} className="shrink-0 text-brand-600" />}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
