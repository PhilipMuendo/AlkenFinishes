import { AlertTriangle, RefreshCw } from 'lucide-react';
import { errText } from '@/lib/api';
import { Button } from './button';
import { SkeletonList } from './skeleton';
import { Empty } from './table';

/** The parts of a TanStack query result this needs. Pass the query itself. */
export interface QueryLike {
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  isFetching?: boolean;
  refetch: () => unknown;
}

/**
 * Loading and failure, told apart — and told apart from emptiness.
 *
 * Panels used to render `data?.map(...)` and nothing else, which collapses all
 * three into the same blank rectangle. On a site with one bar of signal that
 * reads as "this site has no defects" when what actually happened is that the
 * request never landed: the most dangerous possible way for this app to be
 * wrong.
 *
 * Renders a skeleton while in flight, a message and a retry when it failed, and
 * **nothing at all** once there is data — so it drops in above the existing
 * list and the caller's own empty state is left exactly as it was:
 *
 * ```tsx
 * const q = useQuery({ ... });
 * const snags = q.data;
 * ...
 * <QueryState query={q} rows={3} />
 * {snags?.length === 0 && <Empty …/>}
 * {snags?.map(…)}
 * ```
 */
export function QueryState({
  query,
  rows = 3,
  /** What failed, named for the reader: "the defects", "this week's reports". */
  noun,
}: {
  query: QueryLike;
  rows?: number;
  noun?: string;
}) {
  if (query.isPending) return <SkeletonList rows={rows} />;
  if (!query.isError) return null;

  return (
    <div className="rounded-xl border border-hairline bg-surface shadow-sm">
      <Empty icon={AlertTriangle}>
        <p className="font-medium text-fg">
          {noun ? `${sentenceCase(noun)} could not be loaded` : 'This could not be loaded'}
        </p>
        <p className="mt-1 max-w-xs text-fg-muted">
          {errText(
            query.error,
            'The connection did not hold. Nothing is wrong with what is on file — try again when you have signal.',
          )}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={query.isFetching}
          onClick={() => query.refetch()}
        >
          <RefreshCw size={14} className={query.isFetching ? 'animate-spin' : undefined} />
          {query.isFetching ? 'Trying…' : 'Try again'}
        </Button>
      </Empty>
    </div>
  );
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
