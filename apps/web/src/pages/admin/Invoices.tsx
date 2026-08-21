import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';
import type {
  AgingBucket,
  CompanyReceivables,
  InvoiceRegisterRow,
  InvoiceStatus,
  Project,
} from '@/lib/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Select } from '@/components/ui/input';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { INVOICE_TYPE_LABEL } from '@/features/InvoiceEditor';
import { InvoiceStatusBadge } from '@/features/InvoicesPanel';

const BUCKET_LABEL: Record<AgingBucket, string> = {
  CURRENT: 'Not yet due',
  D1_30: '1–30 days',
  D31_60: '31–60 days',
  D61_90: '61–90 days',
  D90_PLUS: 'Over 90 days',
};

const BUCKET_ORDER: AgingBucket[] = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'];

const BUCKET_FILL: Record<AgingBucket, string> = {
  CURRENT: 'bg-emerald-500',
  D1_30: 'bg-amber-400',
  D31_60: 'bg-orange-500',
  D61_90: 'bg-red-400',
  D90_PLUS: 'bg-red-600',
};

type StatusFilter = '' | InvoiceStatus;

export function InvoicesPage() {
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [overdue, setOverdue] = useState('');

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
  });
  const { data: receivables } = useQuery({
    queryKey: ['invoices', 'receivables'],
    queryFn: () => api<CompanyReceivables>('/invoices/receivables'),
  });
  const { data: rows, isLoading } = useQuery({
    queryKey: ['invoices', 'register', { projectId, status, overdue }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', projectId);
      if (status) params.set('status', status);
      if (overdue) params.set('overdue', overdue);
      const qs = params.toString();
      return api<InvoiceRegisterRow[]>(`/invoices${qs ? `?${qs}` : ''}`);
    },
  });

  const totalAr = receivables?.totalAr ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receivables"
        description="Every issued invoice across all sites, and what is still owed"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
              Total outstanding
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{fmtMoney(totalAr)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Overdue</p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                (receivables?.totalOverdue ?? 0) > 0 ? 'text-danger-fg' : 'text-fg'
              }`}
            >
              {fmtMoney(receivables?.totalOverdue ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card className="sm:col-span-2">
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Ageing</p>
            {/* A proportional bar reads faster than five numbers in a row. */}
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-sunken">
              {BUCKET_ORDER.map((b) => {
                const v = receivables?.buckets[b] ?? 0;
                const pct = totalAr > 0 ? (v / totalAr) * 100 : 0;
                if (pct <= 0) return null;
                return (
                  <div
                    key={b}
                    className={BUCKET_FILL[b]}
                    style={{ width: `${pct}%` }}
                    title={`${BUCKET_LABEL[b]}: ${fmtMoney(v)}`}
                  />
                );
              })}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5">
              {BUCKET_ORDER.map((b) => (
                <div key={b}>
                  <dt className="text-fg-subtle">{BUCKET_LABEL[b]}</dt>
                  <dd className="font-medium tabular-nums text-fg">
                    {fmtMoney(receivables?.buckets[b] ?? 0)}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Site">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All sites</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="">Issued and beyond</option>
            <option value="ISSUED">Issued</option>
            <option value="PARTIALLY_PAID">Part paid</option>
            <option value="PAID">Paid</option>
            <option value="VOID">Void</option>
            <option value="DRAFT">Draft</option>
          </Select>
        </Field>
        <Field label="Show">
          <Select value={overdue} onChange={(e) => setOverdue(e.target.value)}>
            <option value="">Everything</option>
            <option value="true">Overdue only</option>
          </Select>
        </Field>
      </div>

      {isLoading && <Skeleton className="h-64 w-full rounded-xl" />}

      {!isLoading && rows?.length === 0 && (
        <Empty icon={FileText}>
          <p className="font-medium text-fg">No invoices match</p>
          <p className="mt-1 max-w-xs text-fg-muted">
            {projectId || status || overdue
              ? 'Try widening the filters above.'
              : 'Invoices raised on a site will appear here.'}
          </p>
        </Empty>
      )}

      {!isLoading && rows && rows.length > 0 && (
        <Card className="overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Site</Th>
                <Th>Client</Th>
                <Th>Due</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Balance</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.status === 'VOID' ? 'opacity-55' : undefined}>
                  <Td>
                    <span className="font-medium text-fg">{r.invoiceNo}</span>
                    <p className="text-xs text-fg-subtle">
                      {INVOICE_TYPE_LABEL[r.type]}
                      {r.title && r.title !== INVOICE_TYPE_LABEL[r.type] ? ` · ${r.title}` : ''}
                    </p>
                  </Td>
                  <Td>
                    <Link
                      to={`/admin/sites/${r.project.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {r.project.name}
                    </Link>
                  </Td>
                  <Td>{r.clientName}</Td>
                  <Td className="whitespace-nowrap">
                    {fmtDate(r.dueDate)}
                    {r.overdue && <p className="text-xs text-danger-fg">{r.daysOverdue}d late</p>}
                  </Td>
                  <Td className="text-right tabular-nums">{fmtMoney(r.netPayable)}</Td>
                  <Td className="text-right font-medium tabular-nums">
                    {r.status === 'VOID' ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      fmtMoney(r.balance)
                    )}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <InvoiceStatusBadge invoice={r} />
                      {r.overdue && r.status !== 'VOID' && (
                        <Badge tone="slate">{BUCKET_LABEL[r.agingBucket]}</Badge>
                      )}
                    </div>
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
