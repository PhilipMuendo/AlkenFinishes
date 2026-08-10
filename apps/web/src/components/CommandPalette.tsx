import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  Contact,
  CornerDownLeft,
  FileSignature,
  FileText,
  HardHat,
  Search,
  Truck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import type { Client, Contract, Project, Quotation, Supplier, Worker } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Find anything by name.
 *
 * Seventeen admin pages, and every record nested under a project — so reaching
 * a contract meant already knowing which screen owned it. This asks for the
 * name instead of the location.
 *
 * The lists are fetched once when it first opens and filtered in the browser.
 * At this company's size that is a few hundred rows and a search that responds
 * on the keystroke; a server-side search endpoint would be slower and buy
 * nothing until the data is an order of magnitude bigger.
 */

interface Hit {
  id: string;
  label: string;
  detail?: string;
  group: string;
  icon: LucideIcon;
  to: string;
}

/** Destinations, so the palette also works as navigation. */
const PAGES: Hit[] = [
  { id: 'p-overview', label: 'Overview', group: 'Go to', icon: Building2, to: '/admin' },
  { id: 'p-projects', label: 'Projects', group: 'Go to', icon: Building2, to: '/admin/projects' },
  { id: 'p-clients', label: 'Clients', group: 'Go to', icon: Contact, to: '/admin/clients' },
  { id: 'p-leads', label: 'Leads', group: 'Go to', icon: FileText, to: '/admin/leads' },
  { id: 'p-quotes', label: 'Quotations', group: 'Go to', icon: FileText, to: '/admin/quotations' },
  { id: 'p-contracts', label: 'Contracts', group: 'Go to', icon: FileSignature, to: '/admin/contracts' },
  { id: 'p-recv', label: 'Receivables', group: 'Go to', icon: FileText, to: '/admin/invoices' },
  { id: 'p-pay', label: 'Payables', group: 'Go to', icon: Truck, to: '/admin/suppliers' },
  { id: 'p-payroll', label: 'Payroll', group: 'Go to', icon: HardHat, to: '/admin/payroll' },
  { id: 'p-tax', label: 'Tax position', group: 'Go to', icon: FileText, to: '/admin/tax' },
  { id: 'p-workers', label: 'Workers', group: 'Go to', icon: HardHat, to: '/admin/workers' },
  { id: 'p-reports', label: 'Reports', group: 'Go to', icon: FileText, to: '/admin/reports' },
  { id: 'p-team', label: 'Team', group: 'Go to', icon: Contact, to: '/admin/users' },
  { id: 's-company', label: 'Settings — company letterhead', group: 'Go to', icon: FileText, to: '/admin/settings/company' },
  { id: 's-docs', label: 'Settings — quotations, contracts & invoicing', group: 'Go to', icon: FileText, to: '/admin/settings/documents' },
  { id: 's-money', label: 'Settings — budgets, tax & payroll rates', group: 'Go to', icon: FileText, to: '/admin/settings/money' },
  { id: 's-att', label: 'Settings — attendance devices', group: 'Go to', icon: FileText, to: '/admin/settings/attendance' },
  { id: 's-ai', label: 'Settings — assistant allowance', group: 'Go to', icon: FileText, to: '/admin/settings/assistant' },
  { id: 's-audit', label: 'Settings — audit log', group: 'Go to', icon: FileText, to: '/admin/settings/audit' },
];

const MAX_PER_GROUP = 5;

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // `staleTime: Infinity` — a palette does not need to be live, and refetching
  // six lists every time it opens would make it feel slower than the sidebar.
  const opts = { enabled: open, staleTime: Infinity };
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
    ...opts,
  });
  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api<Client[]>('/clients'),
    ...opts,
  });
  const { data: contracts } = useQuery({
    queryKey: ['contracts'],
    queryFn: () => api<Contract[]>('/contracts'),
    ...opts,
  });
  const { data: quotations } = useQuery({
    queryKey: ['quotations'],
    queryFn: () => api<Quotation[]>('/quotations'),
    ...opts,
  });
  const { data: workers } = useQuery({
    queryKey: ['workers'],
    queryFn: () => api<Worker[]>('/workers'),
    ...opts,
  });
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<Supplier[]>('/suppliers'),
    ...opts,
  });

  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();

    const all: Hit[] = [
      ...(projects ?? []).map((p) => ({
        id: `pr-${p.id}`,
        label: p.name,
        detail: [p.code, p.clientName, p.location].filter(Boolean).join(' · '),
        group: 'Sites',
        icon: Building2,
        to: `/admin/projects/${p.id}`,
      })),
      ...(contracts ?? []).map((c) => ({
        id: `co-${c.id}`,
        label: c.contractNo ?? 'Draft contract',
        detail: c.client?.name,
        group: 'Contracts',
        icon: FileSignature,
        to: '/admin/contracts',
      })),
      ...(quotations ?? []).map((qt) => ({
        id: `qu-${qt.id}`,
        label: qt.quotationNo ?? qt.title,
        detail: [qt.quotationNo ? qt.title : null, qt.clientNameSnapshot].filter(Boolean).join(' · '),
        group: 'Quotations',
        icon: FileText,
        to: '/admin/quotations',
      })),
      ...(clients ?? []).map((c) => ({
        id: `cl-${c.id}`,
        label: c.name,
        detail: c.phone ?? c.email ?? undefined,
        group: 'Clients',
        icon: Contact,
        to: '/admin/clients',
      })),
      ...(workers ?? []).map((w) => ({
        id: `wo-${w.id}`,
        label: w.name,
        detail: [w.trade, w.assignments[0]?.project.name].filter(Boolean).join(' · '),
        group: 'Workers',
        icon: HardHat,
        to: '/admin/workers',
      })),
      ...(suppliers ?? []).map((s) => ({
        id: `su-${s.id}`,
        label: s.name,
        detail: s.contactName ?? s.phone ?? undefined,
        group: 'Suppliers',
        icon: Truck,
        to: '/admin/suppliers',
      })),
      ...PAGES,
    ];

    if (!term) return PAGES.slice(0, 6);

    const matches = all.filter(
      (h) =>
        h.label.toLowerCase().includes(term) || (h.detail ?? '').toLowerCase().includes(term),
    );

    // Cap each group so one long list cannot bury the others.
    const seen: Record<string, number> = {};
    return matches.filter((h) => {
      seen[h.group] = (seen[h.group] ?? 0) + 1;
      return seen[h.group] <= MAX_PER_GROUP;
    });
  }, [q, projects, clients, contracts, quotations, workers, suppliers]);

  useEffect(() => setCursor(0), [q]);

  useEffect(() => {
    if (!open) {
      setQ('');
      setCursor(0);
    }
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  const go = (hit?: Hit) => {
    if (!hit) return;
    navigate(hit.to);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(hits.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(hits[cursor]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  let lastGroup = '';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <button
        aria-label="Close search"
        className="fixed inset-0 bg-slate-950/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative flex max-h-[70dvh] w-full max-w-xl animate-fade-in flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-lg"
      >
        <div className="flex items-center gap-2.5 border-b border-hairline px-4">
          <Search size={17} className="shrink-0 text-fg-subtle" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search sites, contracts, clients, workers…"
            className="w-full bg-transparent py-3.5 text-base text-fg outline-none placeholder:text-fg-subtle sm:text-sm"
          />
          <kbd className="hidden shrink-0 rounded border border-hairline-strong px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle sm:block">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {hits.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-fg-muted">
              Nothing matches &ldquo;{q}&rdquo;.
            </p>
          )}
          {hits.map((hit, i) => {
            const header = hit.group !== lastGroup ? hit.group : null;
            lastGroup = hit.group;
            return (
              <div key={hit.id}>
                {header && (
                  <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                    {header}
                  </p>
                )}
                <button
                  data-active={i === cursor}
                  onMouseMove={() => setCursor(i)}
                  onClick={() => go(hit)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                    i === cursor ? 'bg-surface-sunken' : 'hover:bg-surface-muted',
                  )}
                >
                  <hit.icon size={16} className="shrink-0 text-fg-subtle" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{hit.label}</span>
                    {hit.detail && (
                      <span className="block truncate text-xs text-fg-subtle">{hit.detail}</span>
                    )}
                  </span>
                  {i === cursor && (
                    <CornerDownLeft size={14} className="shrink-0 text-fg-subtle" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Opens on Ctrl/Cmd-K from anywhere, without stealing the key from a field. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey)) return;
      // A native <dialog> renders in the top layer, above any z-index. Opening
      // the palette behind an open form would look like the shortcut is broken
      // and would leave a focus trap the user cannot see, so it stays shut
      // until the dialog is dealt with.
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen };
}
