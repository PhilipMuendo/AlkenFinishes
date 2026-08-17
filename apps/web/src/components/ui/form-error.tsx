import { AlertCircle } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The failure message for a form or an action.
 *
 * `role="alert"` is the point of it: these sit at the bottom of long forms
 * inside a scrollable dialog, so without it a screen reader — and often a
 * sighted user — gets no signal at all that the submit failed.
 *
 * Takes the raw error rather than a string so call sites stop repeating
 * `err instanceof ApiRequestError ? err.message : '…'`, and renders nothing
 * when there is no error.
 */
export function FormError({
  error,
  fallback,
  className,
}: {
  error: unknown;
  /** Shown when the failure was not something the API explained. */
  fallback?: string;
  className?: string;
}) {
  const message = errorMessage(error, fallback);
  if (!message) return null;
  return (
    <p role="alert" className={cn('flex items-start gap-1.5 text-sm text-red-600', className)}>
      <AlertCircle size={15} aria-hidden className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}
