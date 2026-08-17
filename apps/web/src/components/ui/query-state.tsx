import type { UseQueryResult } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';

/** A failed load, with the one action that can fix it. */
export function ErrorState({
  title = 'Couldn’t load this',
  error,
  onRetry,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
}) {
  const detail = errorMessage(error, 'The server did not respond.');
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
          <AlertTriangle size={20} aria-hidden />
        </div>
        <div>
          <p className="font-medium text-fg">{title}</p>
          {detail && <p className="mt-1 max-w-sm text-sm text-fg-muted">{detail}</p>}
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Renders the three states a query can actually be in.
 *
 * The bug this exists to prevent: `if (!data) return <p>Loading…</p>` treats a
 * failed request as a pending one, so a dead connection parks the user on a
 * "Loading…" that never resolves and offers nothing to click.
 */
export function QueryState<T>({
  query,
  skeleton,
  errorTitle,
  children,
}: {
  query: UseQueryResult<T>;
  /** Defaults to a stack of skeleton rows. */
  skeleton?: React.ReactNode;
  errorTitle?: string;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isPending) return <>{skeleton ?? <SkeletonList />}</>;
  if (query.isError || query.data === undefined) {
    return (
      <ErrorState title={errorTitle} error={query.error} onRetry={() => void query.refetch()} />
    );
  }
  return <>{children(query.data)}</>;
}
