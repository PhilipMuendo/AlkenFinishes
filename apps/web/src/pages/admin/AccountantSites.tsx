import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Project } from '@/lib/types';
import { fmtMoney } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

const STATUS_TONE: Record<Project['status'], 'slate' | 'blue' | 'green' | 'red' | 'yellow'> = {
  PLANNING: 'slate',
  ACTIVE: 'blue',
  ON_HOLD: 'yellow',
  COMPLETED: 'green',
  CANCELLED: 'red',
};

/**
 * The accountant's way into a site: a plain list of names and contract
 * value, nothing about tasks, attendance or defects. Picking one lands on
 * AccountantProjectMoneyPage, not the ops-heavy ProjectDetailPage.
 */
export function AccountantSitesPage() {
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Sites" description="Pick a site to work with its expenses, payments and reports" />

      {isLoading && <Skeleton className="h-64 w-full rounded-xl" />}

      {!isLoading && projects?.length === 0 && (
        <Empty icon={Building2}>
          <p className="font-medium text-fg">No sites yet</p>
        </Empty>
      )}

      {!isLoading && projects && projects.length > 0 && (
        <Card className="overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Site</Th>
                <Th>Client</Th>
                <Th className="text-right">Contract value</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link to={`/admin/sites/${p.id}`} className="font-medium text-brand-700 hover:underline">
                      {p.name}
                    </Link>
                    {p.code && <p className="text-xs text-fg-subtle">{p.code}</p>}
                  </Td>
                  <Td>{p.clientName}</Td>
                  <Td className="text-right tabular-nums">{fmtMoney(Number(p.contractValue))}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[p.status]}>{p.status.replace('_', ' ')}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
