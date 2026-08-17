import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, Target } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { Client, Lead, LeadStage } from '@/lib/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { FormError } from '@/components/ui/form-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Enquiries being chased, laid out as the pipeline they are.
 *
 * Columns rather than a table: the question this page answers is "what stage is
 * everything at", which a board shows at a glance and a sorted list does not.
 */

const OPEN_STAGES: { id: LeadStage; label: string; hint: string }[] = [
  { id: 'NEW', label: 'New', hint: 'Just came in' },
  { id: 'CONTACTED', label: 'Contacted', hint: 'Spoken to' },
  { id: 'SITE_VISIT', label: 'Site visit', hint: 'Been to see it' },
  { id: 'QUOTED', label: 'Quoted', hint: 'Price is with them' },
];
const ALL_STAGES: LeadStage[] = [...OPEN_STAGES.map((s) => s.id), 'WON', 'LOST'];

const STAGE_LABEL: Record<LeadStage, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  SITE_VISIT: 'Site visit',
  QUOTED: 'Quoted',
  WON: 'Won',
  LOST: 'Lost',
};

export function LeadsPage() {
  const qc = useQueryClient();
  const [showSettled, setShowSettled] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [losing, setLosing] = useState<Lead | null>(null);

  const { data: leads, isLoading } = useQuery({
    queryKey: queryKeys.leads.all(),
    queryFn: () => api<Lead[]>('/leads'),
  });
  const { data: clients } = useQuery({
    queryKey: queryKeys.clients.list(),
    queryFn: () => api<Client[]>('/clients'),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.leads.all() });
    void qc.invalidateQueries({ queryKey: queryKeys.analytics.company() });
  };

  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Record<string, unknown> }) =>
      id ? api(`/leads/${id}`, { method: 'PUT', body }) : api('/leads', { body }),
    onSuccess: () => {
      invalidate();
      setCreating(false);
      setEditing(null);
    },
  });

  const move = useMutation({
    mutationFn: ({ id, stage, lostReason }: { id: string; stage: LeadStage; lostReason?: string }) =>
      api(`/leads/${id}/stage`, { body: { stage, lostReason } }),
    onSuccess: () => {
      invalidate();
      setLosing(null);
    },
  });

  const byStage = useMemo(() => {
    const map = Object.fromEntries(ALL_STAGES.map((s) => [s, [] as Lead[]])) as Record<
      LeadStage,
      Lead[]
    >;
    for (const l of leads ?? []) map[l.stage].push(l);
    return map;
  }, [leads]);

  const openValue = (leads ?? [])
    .filter((l) => l.stage !== 'WON' && l.stage !== 'LOST')
    .reduce((s, l) => s + (l.estimatedValue ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description={
          leads
            ? `${leads.filter((l) => l.stage !== 'WON' && l.stage !== 'LOST').length} open · ${fmtMoney(openValue)} in the pipeline`
            : 'Enquiries you are chasing'
        }
        actions={
          <Button
            onClick={() => {
              save.reset();
              setCreating(true);
            }}
          >
            <Plus size={16} /> Add lead
          </Button>
        }
      />

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {OPEN_STAGES.map((s) => (
            <Skeleton key={s.id} className="h-56 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && leads?.length === 0 && (
        <Card>
          <CardContent>
            <Empty icon={Target}>
              <p className="font-medium text-fg">No leads yet</p>
              <p className="mt-1 max-w-xs text-fg-muted">
                Log an enquiry here and it carries through to the quotation without retyping the
                client.
              </p>
              <Button className="mt-3" onClick={() => setCreating(true)}>
                <Plus size={16} /> Add lead
              </Button>
            </Empty>
          </CardContent>
        </Card>
      )}

      {!isLoading && !!leads?.length && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {OPEN_STAGES.map((stage) => {
            const items = byStage[stage.id];
            const value = items.reduce((s, l) => s + (l.estimatedValue ?? 0), 0);
            return (
              <section
                key={stage.id}
                className="flex flex-col rounded-xl border border-hairline bg-surface-muted/50"
              >
                <header className="border-b border-hairline px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="text-sm font-semibold text-fg">{stage.label}</h2>
                    <span className="text-xs nums text-fg-subtle">{items.length}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    {value > 0 ? fmtMoney(value) : stage.hint}
                  </p>
                </header>

                <div className="flex-1 space-y-2 p-2">
                  {items.length === 0 && (
                    <p className="px-1 py-6 text-center text-xs text-fg-subtle">Nothing here</p>
                  )}
                  {items.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onEdit={() => {
                        save.reset();
                        setEditing(lead);
                      }}
                      onAdvance={(to) =>
                        to === 'LOST'
                          ? setLosing(lead)
                          : move.mutate({ id: lead.id, stage: to })
                      }
                      busy={move.isPending}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {!isLoading && !!leads?.length && (byStage.WON.length > 0 || byStage.LOST.length > 0) && (
        <div>
          <button
            onClick={() => setShowSettled((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
          >
            <ChevronRight
              size={16}
              className={showSettled ? 'rotate-90 transition-transform' : 'transition-transform'}
            />
            Settled — {byStage.WON.length} won, {byStage.LOST.length} lost
          </button>

          {showSettled && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(['WON', 'LOST'] as const).map((s) => (
                <section key={s} className="rounded-xl border border-hairline bg-surface-muted/50">
                  <header className="border-b border-hairline px-3 py-2.5">
                    <h2 className="text-sm font-semibold text-fg">{STAGE_LABEL[s]}</h2>
                  </header>
                  <div className="space-y-2 p-2">
                    {byStage[s].length === 0 && (
                      <p className="px-1 py-4 text-center text-xs text-fg-subtle">None</p>
                    )}
                    {byStage[s].map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        settled
                        onEdit={() => setEditing(lead)}
                        onAdvance={(to) => move.mutate({ id: lead.id, stage: to })}
                        busy={move.isPending}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog
        open={creating || !!editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? 'Edit lead' : 'Add lead'}
      >
        <form
          key={editing?.id ?? 'new'}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const value = fd.get('estimatedValue');
            save.mutate({
              id: editing?.id,
              body: {
                clientId: fd.get('clientId'),
                title: fd.get('title'),
                description: fd.get('description') || undefined,
                estimatedValue: value ? Number(value) : undefined,
                source: fd.get('source') || undefined,
                expectedCloseDate: fd.get('expectedCloseDate') || undefined,
              },
            });
          }}
          className="space-y-3"
        >
          <Field label="Client">
            <Combobox
              name="clientId"
              placeholder="Search clients…"
              aria-label="Client"
              defaultValue={editing?.clientId}
              options={(clients ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
          <Field label="What is the job?">
            <Input
              name="title"
              defaultValue={editing?.title}
              required
              placeholder="e.g. Riverside Tower — interior finishes"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Estimated value (KES)">
              <Input
                name="estimatedValue"
                type="number"
                min="0"
                step="1000"
                inputMode="decimal"
                defaultValue={editing?.estimatedValue ?? ''}
              />
            </Field>
            <Field label="Expected close">
              <Input
                name="expectedCloseDate"
                type="date"
                defaultValue={editing?.expectedCloseDate?.slice(0, 10) ?? ''}
              />
            </Field>
          </div>
          <Field label="Where did it come from?">
            <Input
              name="source"
              defaultValue={editing?.source ?? ''}
              placeholder="Referral, walk-in, tender…"
            />
          </Field>
          <Field label="Notes">
            <Textarea name="description" defaultValue={editing?.description ?? ''} rows={2} />
          </Field>

          <FormError error={save.error} fallback="Failed to save" />
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {editing ? 'Save changes' : 'Add lead'}
          </Button>
        </form>
      </Dialog>

      <Dialog
        open={!!losing}
        onClose={() => {
          setLosing(null);
          move.reset();
        }}
        title={losing ? `Mark "${losing.title}" as lost` : ''}
      >
        <form
          key={losing?.id ?? 'none'}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            move.mutate({
              id: losing!.id,
              stage: 'LOST',
              lostReason: String(fd.get('lostReason')),
            });
          }}
          className="space-y-3"
        >
          <Field label="Why did we lose it?">
            <Textarea
              name="lostReason"
              required
              rows={2}
              autoFocus
              placeholder="Price, timing, went to another contractor…"
            />
          </Field>
          <p className="text-xs text-fg-subtle">
            Worth a sentence — the pattern in these is the most useful thing the pipeline tells you.
          </p>
          <FormError error={move.error} fallback="Failed to save" />
          <Button type="submit" className="w-full" disabled={move.isPending}>
            Mark as lost
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

function LeadCard({
  lead,
  settled,
  onEdit,
  onAdvance,
  busy,
}: {
  lead: Lead;
  settled?: boolean;
  onEdit: () => void;
  onAdvance: (to: LeadStage) => void;
  busy: boolean;
}) {
  const idx = OPEN_STAGES.findIndex((s) => s.id === lead.stage);
  const next = idx >= 0 && idx < OPEN_STAGES.length - 1 ? OPEN_STAGES[idx + 1] : null;
  const overdue =
    !settled && lead.expectedCloseDate && new Date(lead.expectedCloseDate) < new Date();

  return (
    <article className="rounded-lg border border-hairline bg-surface p-3 shadow-xs">
      <button onClick={onEdit} className="block w-full text-left">
        <p className="text-sm font-medium leading-snug text-fg">{lead.title}</p>
        <p className="mt-0.5 text-xs text-fg-subtle">{lead.client.name}</p>
      </button>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {lead.estimatedValue != null && (
          <span className="text-sm font-semibold nums text-fg">
            {fmtMoney(lead.estimatedValue)}
          </span>
        )}
        {lead.quotations.length > 0 && (
          <Badge tone="blue">
            {lead.quotations.length} quote{lead.quotations.length > 1 ? 's' : ''}
          </Badge>
        )}
        {overdue && <Badge tone="yellow">Past close date</Badge>}
      </div>

      {lead.expectedCloseDate && !settled && (
        <p className="mt-1 text-xs text-fg-subtle">Close by {fmtDate(lead.expectedCloseDate)}</p>
      )}
      {lead.lostReason && <p className="mt-1 text-xs text-fg-muted">{lead.lostReason}</p>}

      {!settled && (
        <div className="mt-2.5 flex gap-1.5">
          {next && (
            <Button
              size="sm"
              variant="secondary"
              className="flex-1"
              disabled={busy}
              onClick={() => onAdvance(next.id)}
            >
              {next.label}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAdvance('LOST')}>
            Lost
          </Button>
        </div>
      )}
    </article>
  );
}
