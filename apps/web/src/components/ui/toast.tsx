import { useEffect, useRef, useSyncExternalStore } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Confirming that something happened.
 *
 * The app was good at saying an action had *started* — every button has a
 * pending state — and said nothing at all about whether it had *worked*. A
 * dialog closing is not confirmation: it is what happens on success and on a
 * dismissed form alike. For a system where one press moves KES 200,000, the
 * user should be told what was recorded, in the same words they would use to
 * check it.
 *
 * So the message is the caller's job, and it should name the figure and the
 * document — "Payment of KES 200,000 recorded against ALK-2026-000112", not
 * "Saved". A toast nobody can check is only marginally better than silence.
 *
 * Deliberately a module-level store rather than context: it is called from
 * `onSuccess` callbacks, which are not components and cannot use hooks.
 */

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  /** Errors stay until dismissed; there is no rush to hide a failure. */
  duration: number | null;
}

const DURATION: Record<ToastTone, number | null> = {
  success: 5000,
  info: 5000,
  error: null,
};

/** Older toasts are dropped rather than stacking into a wall. */
const MAX_VISIBLE = 3;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function push(tone: ToastTone, message: string): number {
  const id = nextId++;
  toasts = [...toasts, { id, tone, message, duration: DURATION[tone] }].slice(-MAX_VISIBLE);
  emit();
  return id;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
  info: (message: string) => push('info', message),
};

const TONE: Record<ToastTone, { icon: LucideIcon; className: string }> = {
  success: { icon: CheckCircle2, className: 'border-good-hairline bg-good-surface text-good-fg' },
  error: { icon: AlertTriangle, className: 'border-danger-hairline bg-danger-surface text-danger-fg' },
  info: { icon: Info, className: 'border-info-hairline bg-info-surface text-info-fg' },
};

function ToastRow({ t }: { t: Toast }) {
  useEffect(() => {
    if (t.duration == null) return;
    const timer = setTimeout(() => dismissToast(t.id), t.duration);
    return () => clearTimeout(timer);
  }, [t.id, t.duration]);

  const { icon: Icon, className } = TONE[t.tone];
  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border p-3 text-sm shadow-md animate-fade-in',
        className,
      )}
    >
      <Icon size={18} className="mt-px shrink-0" />
      <p className="min-w-0 flex-1">{t.message}</p>
      <button
        onClick={() => dismissToast(t.id)}
        aria-label="Dismiss"
        className="-m-1 shrink-0 rounded-lg p-1 opacity-60 transition-opacity hover:opacity-100"
      >
        <X size={15} />
      </button>
    </div>
  );
}

/**
 * Rendered once per layout, above everything.
 *
 * `aria-live="polite"` so the confirmation reaches a screen reader without
 * interrupting.
 *
 * The bottom offset has to clear whatever else is anchored down there, because
 * a toast is worthless if it lands on the thing it covers. Both shells carry
 * the assistant launcher (3rem tall, bottom-right); the supervisor shell adds
 * its navigation bar under that. `aboveNav` picks the taller of the two
 * clearances.
 *
 * The `popover` attribute is what puts it above an open dialog. `Dialog` uses
 * native `showModal()`, which promotes it to the browser's top layer — above
 * every z-index there is — so a toast fired from inside a form used to appear
 * behind the very dialog that raised it. Errors were the ones this hit, since
 * they fire while the dialog is still open. A manual popover joins the same
 * top layer, so the last one shown wins, and that is the toast.
 */
export function Toaster({ aboveNav = false }: { aboveNav?: boolean }) {
  const items = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => toasts,
  );

  const ref = useRef<HTMLDivElement>(null);

  // Show it as a popover only while something is in it: an empty popover in the
  // top layer would sit over the page swallowing nothing, and `showPopover`
  // throws if it is already open.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== 'function') return;
    try {
      if (items.length > 0) el.showPopover();
      else el.hidePopover();
    } catch {
      // Already in the requested state, or popovers unsupported. Either way the
      // element still renders normally — it just loses the top-layer promotion.
    }
  }, [items.length]);

  return (
    <div
      ref={ref}
      // React 18's types predate the popover attribute; the DOM understands it.
      {...({ popover: 'manual' } as Record<string, string>)}
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        'pointer-events-none fixed inset-x-0 inset-y-auto bottom-0 z-[60] m-0 flex max-h-none w-full max-w-none flex-col items-center gap-2 border-0 bg-transparent p-4 sm:inset-x-auto sm:right-0 sm:items-end',
        aboveNav
          ? // nav (4.75rem) + launcher (3rem) + gap
            'pb-[calc(8.5rem+env(safe-area-inset-bottom))]'
          : // launcher (1rem offset + 3rem) + gap
            'pb-[calc(4.75rem+env(safe-area-inset-bottom))]',
      )}
    >
      <div className="flex w-full max-w-sm flex-col gap-2">
        {items.map((t) => (
          <ToastRow key={t.id} t={t} />
        ))}
      </div>
    </div>
  );
}
