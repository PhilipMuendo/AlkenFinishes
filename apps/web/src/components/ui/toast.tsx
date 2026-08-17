import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, X, AlertCircle } from 'lucide-react';
import { cn, focusRing } from '@/lib/utils';

/**
 * Confirmation that something happened.
 *
 * The app previously had no channel for this at all: a mutation succeeded and
 * the screen simply did not change, so people tapped "Submit" twice. Errors
 * that belong to a *form* still render inline next to it via `<FormError>` —
 * this is for actions whose result would otherwise be invisible.
 *
 * The viewport is `aria-live="polite"`, so a screen reader hears the message
 * without losing the user's place.
 */
type ToastTone = 'success' | 'error';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DISMISS_AFTER_MS = 4500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  // Held so a toast dismissed early does not fire its timer against a reused id.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_AFTER_MS),
      );
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:items-end"
      >
        {toasts.map((toast) => (
          <ToastRow key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const isError = toast.tone === 'error';
  const Icon = isError ? AlertCircle : CheckCircle2;
  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full max-w-sm animate-fade-in items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-md',
        isError ? 'border-red-200 bg-red-50 text-red-800' : 'border-hairline bg-surface text-fg',
      )}
    >
      <Icon
        size={17}
        aria-hidden
        className={cn('mt-0.5 shrink-0', isError ? 'text-red-600' : 'text-emerald-600')}
      />
      <p className="min-w-0 flex-1 text-sm">{toast.message}</p>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className={cn(
          'shrink-0 rounded-md p-0.5 opacity-60 transition-opacity hover:opacity-100',
          focusRing,
        )}
      >
        <X size={15} />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
