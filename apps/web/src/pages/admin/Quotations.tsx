import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSignature, FileText, Plus } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import type { Client, Lead, Quotation, QuotationStatus } from '@/lib/types';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { QuotationEditor, type QuotationPayload } from '@/features/QuotationEditor';

const STATUS_TONE: Record<QuotationStatus, 'slate' | 'blue' | 'green' | 'red' | 'yellow'> = {
  DRAFT: 'slate',
  SENT: 'blue',
  ACCEPTED: 'green',
  REJECTED: 'red',
  EXPIRED: 'yellow',
};

interface Defaults {
  vatRatePct: number;
  validityDays: number;
  termsText: string;
}

function errorMessage(err: unknown): string | null {
  if (!err) return null;
  return err instanceof ApiRequestError ? err.message : 'That action failed';
}

export function QuotationsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<QuotationStatus | ''>('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [viewing, setViewing] = useState<Quotation | null>(null);
  const [rejecting, setRejecting] = useState<Quotation | null>(null);
  const [converting, setConverting] = useState<Quotation | null>(null);

  const { data: quotations, isLoading } = useQuery({
    queryKey: ['quotations', status],
    queryFn: () => api<Quotation[]>(`/quotations${status ? `?status=${status}` : ''}`),
  });
  const { data: clients } = useQuery({
    queryKey: ['clients', ''],
    queryFn: () => api<Client[]>('/clients'),
  });
  const { data: leads } = useQuery({ queryKey: ['leads'], queryFn: () => api<Lead[]>('/leads') });
  const { data: defaults } = useQuery({
    queryKey: ['settings', 'quotationDefaults'],
    queryFn: () => api<Defaults>('/settings/quotation-defaults'),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['quotations'] });
    void qc.invalidateQueries({ queryKey: ['leads'] });
    void qc.invalidateQueries({ queryKey: ['contracts'] });
  };

  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: QuotationPayload }) =>
      id
        ? api<Quotation>(`/quotations/${id}`, { method: 'PUT', body })
        : api<Quotation>('/quotations', { body }),
    onSuccess: (q) => {
      invalidate();
      setEditorOpen(false);
      setEditing(null);
      setViewing(q);
    },
  });

  const send = useMutation({
    mutationFn: (id: string) => api<Quotation>(`/quotations/${id}/send`, { body: {} }),
    onSuccess: (q) => {
      invalidate();
      setViewing(q);
    },
  });

  const decide = useMutation({
    mutationFn: ({
      id,
      outcome,
      reason,
    }: {
      id: string;
      outcome: 'ACCEPTED' | 'REJECTED';
      reason?: string;
    }) => api<Quotation>(`/quotations/${id}/decision`, { body: { outcome, reason } }),
    onSuccess: (q) => {
      invalidate();
      setRejecting(null);
      setViewing(q);
    },
  });

  const toContract = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/contracts/from-quotation/${id}`, { body }),
    onSuccess: () => {
      invalidate();
      setConverting(null);
      setViewing(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/quotations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      setViewing(null);
    },
  });

  // One line for whichever of the detail actions last failed — they are
  // mutually exclusive in practice, and three separate slots would be noise.
  const actionError = errorMessage(send.error ?? decide.error ?? remove.error);

  const openPdf = async (q: Quotation) => {
    const { url } = await api<{ url: string }>(`/quotations/${q.id}/pdf`);
    window.open(url, '_blank', 'noopener');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotations"
        description="Price a job once — an accepted quotation becomes the contract"
        actions={
          <Button
            onClick={() => {
              save.reset();
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus size={16} /> New quotation
          </Button>
        }
      />

      <div className="max-w-[12rem]">
        <Field label="Status">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as QuotationStatus | '')}
          >
            <option value="">All quotations</option>
            {(Object.keys(STATUS_TONE) as QuotationStatus[]).map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {isLoading && <Skeleton className="h-64 w-full rounded-xl" />}

      {!isLoading && quotations?.length === 0 && (
        <Card>
          <CardContent>
            <Empty icon={FileText}>
              <p className="font-medium text-fg">
                {status ? 'Nothing at that status' : 'No quotations yet'}
              </p>
              <p className="mt-1 max-w-xs text-fg-muted">
                Price a job here. Once the client accepts, the contract is raised from it without
                retyping anything.
              </p>
            </Empty>
          </CardContent>
        </Card>
      )}

      {!isLoading && !!quotations?.length && (
        <Card className="overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Client</Th>
                <Th>Job</Th>
                <Th>Issued</Th>
                <Th>Valid until</Th>
                <Th className="text-right">Total</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {quotations.map((q) => (
                <tr key={q.id}>
                  <Td className="whitespace-nowrap font-medium text-fg">
                    {q.quotationNo ?? <span className="text-fg-subtle">Draft</span>}
                  </Td>
                  <Td>{q.clientNameSnapshot}</Td>
                  <Td className="max-w-[16rem] truncate">{q.title}</Td>
                  <Td className="whitespace-nowrap">{fmtDate(q.issueDate)}</Td>
                  <Td className="whitespace-nowrap">{fmtDate(q.validUntil)}</Td>
                  <Td className="text-right tabular-nums">{fmtMoney(q.total)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={STATUS_TONE[q.status]} className="capitalize">
                        {q.status.toLowerCase()}
                      </Badge>
                      {q.expired && <Badge tone="yellow">Lapsed</Badge>}
                      {q.contract && <Badge tone="green">Contracted</Badge>}
                    </div>
                  </Td>
                  <Td className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setViewing(q)}>
                      Open
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* ---- Editor ---- */}
      <Dialog
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        title={editing ? `Edit ${editing.quotationNo ?? 'draft'}` : 'New quotation'}
        className="max-w-2xl"
      >
        {defaults && (
          <QuotationEditor
            key={editing?.id ?? 'new'}
            existing={editing ?? undefined}
            clients={clients ?? []}
            leads={leads ?? []}
            defaults={defaults}
            submitting={save.isPending}
            error={
              save.isError && (
                <p className="text-sm text-red-600">
                  {save.error instanceof ApiRequestError ? save.error.message : 'Failed to save'}
                </p>
              )
            }
            onSubmit={(body) => save.mutate({ id: editing?.id, body })}
          />
        )}
      </Dialog>

      {/* ---- Detail ---- */}
      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? (viewing.quotationNo ?? 'Draft quotation') : ''}
        className="max-w-2xl"
      >
        {viewing && (
          <div className="space-y-4">
            <div>
              <p className="font-medium text-fg">{viewing.title}</p>
              <p className="text-sm text-fg-muted">
                {viewing.clientNameSnapshot} · issued {fmtDate(viewing.issueDate)} · valid until{' '}
                {fmtDate(viewing.validUntil)}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge tone={STATUS_TONE[viewing.status]} className="capitalize">
                  {viewing.status.toLowerCase()}
                </Badge>
                {viewing.expired && <Badge tone="yellow">Past its validity date</Badge>}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-hairline">
              <Table>
                <thead>
                  <tr>
                    <Th>Description</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Rate</Th>
                    <Th className="text-right">Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {viewing.lines.map((l) => (
                    <tr key={l.id}>
                      <Td>
                        {l.description}
                        {!l.taxable && <span className="text-fg-subtle"> · zero-rated</span>}
                      </Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">
                        {l.quantity} {l.unit}
                      </Td>
                      <Td className="text-right tabular-nums">{fmtMoney(l.unitPrice)}</Td>
                      <Td className="text-right tabular-nums">{fmtMoney(l.lineTotal)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>

            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-fg-muted">Subtotal</dt>
                <dd className="tabular-nums">{fmtMoney(viewing.subtotal)}</dd>
              </div>
              {viewing.vatRatePct > 0 && (
                <div className="flex justify-between">
                  <dt className="text-fg-muted">VAT @ {viewing.vatRatePct}%</dt>
                  <dd className="tabular-nums">{fmtMoney(viewing.vatAmount)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-hairline pt-1.5 font-semibold">
                <dt>Quotation total</dt>
                <dd className="tabular-nums">{fmtMoney(viewing.total)}</dd>
              </div>
            </dl>

            {viewing.rejectReason && (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                Turned down: {viewing.rejectReason}
              </p>
            )}
            {viewing.contract && (
              <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
                Contract {viewing.contract.contractNo ?? '(draft)'} has been raised from this
                quotation.
              </p>
            )}

            {actionError && <p className="text-sm text-red-600">{actionError}</p>}

            <div className="flex flex-wrap gap-2 border-t border-hairline pt-3">
              {viewing.status === 'DRAFT' && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditing(viewing);
                      setViewing(null);
                      save.reset();
                      setEditorOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button disabled={send.isPending} onClick={() => send.mutate(viewing.id)}>
                    Send to client
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(viewing.id)}
                  >
                    Delete draft
                  </Button>
                </>
              )}

              {viewing.status !== 'DRAFT' && (
                <Button variant="outline" onClick={() => void openPdf(viewing)}>
                  <Download size={16} /> PDF
                </Button>
              )}

              {(viewing.status === 'SENT' || viewing.status === 'EXPIRED') && (
                <>
                  <Button
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: viewing.id, outcome: 'ACCEPTED' })}
                  >
                    Client accepted
                  </Button>
                  <Button
                    variant="outline"
                    disabled={decide.isPending}
                    onClick={() => setRejecting(viewing)}
                  >
                    Client declined
                  </Button>
                </>
              )}

              {viewing.status === 'ACCEPTED' && !viewing.contract && (
                <Button
                  onClick={() => {
                    toContract.reset();
                    setConverting(viewing);
                  }}
                >
                  <FileSignature size={16} /> Raise contract
                </Button>
              )}
            </div>
          </div>
        )}
      </Dialog>

      {/* ---- Decline ---- */}
      <Dialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Client declined the quotation"
      >
        <form
          key={rejecting?.id ?? 'none'}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            decide.mutate({
              id: rejecting!.id,
              outcome: 'REJECTED',
              reason: String(fd.get('reason')),
            });
          }}
          className="space-y-3"
        >
          <Field label="Why?">
            <Textarea name="reason" required rows={2} autoFocus placeholder="Price, timing…" />
          </Field>
          <p className="text-xs text-fg-subtle">This also marks the lead behind it as lost.</p>
          <Button type="submit" className="w-full" disabled={decide.isPending}>
            Record decision
          </Button>
        </form>
      </Dialog>

      {/* ---- Raise contract ---- */}
      <Dialog
        open={!!converting}
        onClose={() => setConverting(null)}
        title="Raise the contract"
      >
        {converting && (
          <form
            key={converting.id}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              toContract.mutate({
                id: converting.id,
                body: {
                  startDate: fd.get('startDate'),
                  expectedCompletion: fd.get('expectedCompletion'),
                  retentionPct: Number(fd.get('retentionPct')),
                  defectsLiabilityMonths: Number(fd.get('defectsLiabilityMonths')),
                },
              });
            }}
            className="space-y-3"
          >
            <p className="text-sm text-fg-muted">
              The client, the job title and the priced schedule come across from{' '}
              <span className="font-medium text-fg">{converting.quotationNo}</span>. The Contract
              Sum will be{' '}
              <span className="font-medium text-fg">{fmtMoney(converting.subtotal)}</span> excluding
              VAT — only the terms below need filling in.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Start on site">
                <Input name="startDate" type="date" defaultValue={todayISO()} required />
              </Field>
              <Field label="Contractual completion">
                <Input name="expectedCompletion" type="date" required />
              </Field>
              <Field label="Retention (%)">
                <Input
                  name="retentionPct"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue="5"
                  required
                />
              </Field>
              <Field label="Defects liability (months)">
                <Input
                  name="defectsLiabilityMonths"
                  type="number"
                  min="0"
                  max="120"
                  defaultValue="6"
                  required
                />
              </Field>
            </div>
            {toContract.isError && (
              <p className="text-sm text-red-600">
                {toContract.error instanceof ApiRequestError
                  ? toContract.error.message
                  : 'Failed to raise the contract'}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={toContract.isPending}>
              Raise contract
            </Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}
