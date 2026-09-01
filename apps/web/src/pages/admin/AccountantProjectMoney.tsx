import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { api } from '@/lib/api';
import type { Project } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Tabs } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { FinancialsPanel } from '@/features/FinancialsPanel';
import { InvoicesPanel } from '@/features/InvoicesPanel';
import { PaymentsPanel } from '@/features/PaymentsPanel';
import { ExpensesPanel } from '@/features/ExpensesPanel';
import { BusinessReportsPanel } from '@/features/BusinessReportsPanel';

const MONEY_REPORT_TYPES = [
  'financial-summary',
  'client-statement',
  'receivables',
  'variations',
  'expenses',
] as const;

const TABS = [
  { id: 'financials', label: 'Financials' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'payments', label: 'Payments' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'reports', label: 'Reports' },
] as const;
const VALID_TABS = new Set<string>(TABS.map((t) => t.id));

/**
 * The accountant's cut of ProjectDetailPage: money tabs only, no tasks,
 * attendance, snags or safety. The tab shell and every panel below it are
 * the exact same ones the full site page uses — this page just offers fewer
 * of them and drops the status/supervisor controls, which are write actions
 * an accountant cannot perform anyway.
 */
export function AccountantProjectMoneyPage() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') ?? 'financials';
  const tab = VALID_TABS.has(requested) ? requested : 'financials';

  const setTab = (id: string) => {
    const next = new URLSearchParams(params);
    if (id === 'financials') next.delete('tab');
    else next.set('tab', id);
    setParams(next, { replace: true });
  };

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<Project>(`/projects/${projectId}`),
  });

  if (!project) {
    return (
      <div className="space-y-5">
        <div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-3 h-7 w-2/5" />
          <Skeleton className="mt-2 h-4 w-3/5" />
        </div>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/admin/sites"
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
        >
          <ChevronLeft size={16} /> Sites
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{project.name}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {project.code && <span className="font-medium text-fg-subtle">{project.code} · </span>}
          {project.clientName} · {fmtDate(project.startDate)} → {fmtDate(project.expectedCompletion)}
        </p>
      </div>

      <Tabs tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} active={tab} onChange={setTab} />

      {tab === 'financials' && <FinancialsPanel projectId={projectId} />}
      {tab === 'invoices' && <InvoicesPanel projectId={projectId} />}
      {tab === 'payments' && <PaymentsPanel projectId={projectId} />}
      {tab === 'expenses' && <ExpensesPanel projectId={projectId} />}
      {tab === 'reports' && <BusinessReportsPanel projectId={projectId} only={MONEY_REPORT_TYPES} />}
    </div>
  );
}
