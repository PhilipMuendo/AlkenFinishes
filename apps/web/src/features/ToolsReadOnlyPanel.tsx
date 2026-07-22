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
          className="flex items-center justify-between rounded-lg border border-slate-200 p-3"
        >
          <div>
            <p className="font-medium text-slate-900">{t.name}</p>
            {t.category && <p className="text-xs text-slate-500">{t.category}</p>}
          </div>
          <p className="text-sm font-semibold tabular-nums text-slate-900">
            {Number(t.quantity).toLocaleString()}{' '}
            <span className="font-normal text-slate-500">{t.unit}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
