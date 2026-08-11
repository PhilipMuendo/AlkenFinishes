import { useQuery } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import type { Tool } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Empty } from '@/components/ui/table';

/**
 * Read-only: transfers are superadmin-only. The server already scopes this
 * list to the caller's own assigned site by role, so no projectId is passed.
 *
 * Shows the same service-due signal as the Equipment card on Command Centre
 * — a supervisor tapping through from that card should find at least as much
 * detail here, not less.
 */
export function ToolsReadOnlyPanel() {
  const { data: tools } = useQuery({
    queryKey: ['tools'],
    queryFn: () => api<Tool[]>('/tools'),
  });

  return (
    <div className="space-y-2">
      {tools?.length === 0 && (
        <Card>
          <Empty icon={Wrench}>No tools currently at this site</Empty>
        </Card>
      )}
      {tools?.map((t) => {
        const overdue = t.nextServiceDate != null && new Date(t.nextServiceDate) < new Date();
        return (
          <Card key={t.id} className="flex items-center justify-between gap-3 p-3.5">
            <div className="min-w-0">
              <p className="truncate font-medium text-fg">{t.name}</p>
              <p className="truncate text-xs text-fg-muted">
                {t.category ?? 'Uncategorised'}
                {t.nextServiceDate &&
                  ` · ${overdue ? 'was due' : 'next service'} ${fmtDate(t.nextServiceDate)}`}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums text-fg">
                {Number(t.quantity).toLocaleString()}{' '}
                <span className="font-normal text-fg-muted">{t.unit}</span>
              </p>
              <Badge
                tone={t.status === 'ACTIVE' ? (overdue ? 'yellow' : 'green') : 'red'}
                className="mt-1"
              >
                {overdue && t.status === 'ACTIVE' ? 'Service due' : t.status.toLowerCase()}
              </Badge>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
