import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Tool } from '@/lib/types';
import { Empty } from '@/components/ui/table';

/**
 * Read-only: transfers are superadmin-only. The server already scopes this
 * list to the caller's own assigned site by role, so no projectId is passed.
 */
export function ToolsReadOnlyPanel() {
  const { data: tools } = useQuery({
    queryKey: ['tools'],
    queryFn: () => api<Tool[]>('/tools'),
  });

  return (
    <div className="space-y-2">
      {tools?.length === 0 && <Empty>No tools currently at this site</Empty>}
      {tools?.map((t) => (
        <div
          key={t.id}
          className="flex items-center justify-between rounded-lg border border-hairline p-3"
        >
          <div>
            <p className="font-medium text-fg">{t.name}</p>
            {t.category && <p className="text-xs text-fg-muted">{t.category}</p>}
          </div>
          <p className="text-sm font-semibold tabular-nums text-fg">
            {Number(t.quantity).toLocaleString()}{' '}
            <span className="font-normal text-fg-muted">{t.unit}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
