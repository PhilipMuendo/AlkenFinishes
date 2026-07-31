import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Download, FileSignature, HardHat, Plus } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import type { AppUser, Contract, ContractStatus, Variation } from '@/lib/types';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

const STATUS_TONE: Record<ContractStatus, 'slate' | 'blue' | 'green' | 'red' | 'yellow'> = {
  DRAFT: 'slate',
  ISSUED: 'blue',
  SIGNED: 'green',
  ACTIVE: 'green',
  COMPLETED: 'slate',
  TERMINATED: 'red',
};

function errorMessage(err: unknown): string | null {
  if (!err) return null;
  return err instanceof ApiRequestError ? err.message : 'That action failed';
}

export function ContractsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ContractStatus | ''>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [varying, setVarying] = useState(false);
  const [converting, setConverting] = useState(false);

  const { data: contracts, isLoading } = useQuery({
    queryKey: ['contracts', status],
    queryFn: () => api<Contract[]>(`/contracts${status ? `?status=${status}` : ''}`),
  });
  // Fetched fresh rather than read out of the list, so the position and
  // variations are current after every mutation below.
  const { data: contract } = useQuery({
    queryKey: ['contract', openId],
    queryFn: () => api<Contract>(`/contracts/${openId}`),
    enabled: !!openId,
  });
  const { data: team } = useQuery({
    queryKey: ['users'],
    queryFn: () => api<AppUser[]>('/users'),
    enabled: converting,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['contracts'] });
    void qc.invalidateQueries({ queryKey: ['contract', openId] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
    void qc.invalidateQueries({ queryKey: ['analytics', 'company'] });
  };

  const issue = useMutation({
    mutationFn: (id: string) => api(`/contracts/${id}/issue`, { body: {} }),
    onSuccess: invalidate,
  });

  const sign = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) =>
      api(`/contracts/${id}/sign`, { formData }),
    onSuccess: () => {
      invalidate();
      setSigning(false);
    },
  });

  const addVariation = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) =>
      api(`/contracts/${id}/variations`, { formData }),
    onSuccess: () => {
      invalidate();
      setVarying(false);
    },
  });

  const decideVariation = useMutation({
    mutationFn: ({
      id,
      variationId,
      outcome,
      reason,
    }: {
      id: string;
      variationId: string;
      outcome: 'APPROVED' | 'REJECTED';
      reason?: string;
    }) => api(`/contracts/${id}/variations/${variationId}/decision`, { body: { outcome, reason } }),
    onSuccess: invalidate,
  });

  const toProject = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api<{ id: string }>(`/contracts/${id}/convert-to-project`, { body }),
    onSuccess: (project) => {
      invalidate();
      setConverting(false);
      setOpenId(null);
      navigate(`/admin/projects/${project.id}`);
    },
  });

  const openPdf = async (id: string) => {
    const { url } = await api<{ url: string }>(`/contracts/${id}/pdf`);
    window.open(url, '_blank', 'noopener');
  };

  const actionError = errorMessage(issue.error ?? decideVariation.error);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contracts"
        description="What was agreed, what has changed since, and what it is worth now"
      />

      <div className="max-w-[12rem]">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as ContractStatus | '')}>
            <option value="">All contracts</option>
            {(Object.keys(STATUS_TONE) as ContractStatus[]).map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {isLoading && <Skeleton className="h-64 w-full rounded-xl" />}

      {!isLoading && contracts?.length === 0 && (
        <Card>
          <CardContent>
            <Empty icon={FileSignature}>
              <p className="font-medium text-fg">
                {status ? 'Nothing at that status' : 'No contracts yet'}
              </p>
              <p className="mt-1 max-w-sm text-fg-muted">
                Contracts are raised from an accepted quotation, which carries the client, the job
                and the priced schedule across for you.
              </p>
            </Empty>
          </CardContent>
        </Card>
      )}

      {!isLoading && !!contracts?.length && (
        <Card className="overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Client</Th>
                <Th>Job</Th>
                <Th className="text-right">Current value</Th>
                <Th>Dates</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <Td className="whitespace-nowrap font-medium text-fg">
                    {c.contractNo ?? <span className="text-fg-subtle">Draft</span>}
                  </Td>
                  <Td>{c.client.name}</Td>
                  <Td className="max-w-[16rem] truncate">{c.title}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">
                    {fmtMoney(c.position.currentValue)}
                    {c.position.approvedVariations !== 0 && (
                      <p className="text-xs text-fg-subtle">
                        {c.position.approvedVariations > 0 ? '+' : ''}
                        {fmtMoney(c.position.approvedVariations)} in variations
                      </p>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-fg-muted">
                    {fmtDate(c.startDate)} → {fmtDate(c.expectedCompletion)}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={STATUS_TONE[c.status]} className="capitalize">
                        {c.status.toLowerCase()}
                      </Badge>
                      {c.position.pendingVariations !== 0 && (
                        <Badge tone="yellow">Variation pending</Badge>
                      )}
                      {!c.projectId && c.status !== 'DRAFT' && <Badge tone="blue">No site yet</Badge>}
                    </div>
                  </Td>
                  <Td className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setOpenId(c.id)}>
                      Open
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* ---- Detail ---- */}
      <Dialog
        open={!!openId}
        onClose={() => setOpenId(null)}
        title={contract ? (contract.contractNo ?? 'Draft contract') : 'Contract'}
        className="max-w-2xl"
      >
        {contract && (
          <div className="space-y-5">
            <div>
              <p className="font-medium text-fg">{contract.title}</p>
              <p className="text-sm text-fg-muted">
                {contract.client.name} · {fmtDate(contract.startDate)} →{' '}
                {fmtDate(contract.expectedCompletion)}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge tone={STATUS_TONE[contract.status]} className="capitalize">
                  {contract.status.toLowerCase()}
                </Badge>
                {contract.signedDate && (
                  <Badge tone="green">Signed {fmtDate(contract.signedDate)}</Badge>
                )}
              </div>
            </div>

            <Position contract={contract} />

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-fg">Variation orders</h3>
                {contract.status !== 'DRAFT' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      addVariation.reset();
                      setVarying(true);
                    }}
                  >
                    <Plus size={14} /> Add
                  </Button>
                )}
              </div>
              {contract.variations.length === 0 ? (
                <p className="rounded-lg border border-dashed border-hairline-strong px-3 py-4 text-center text-xs text-fg-subtle">
                  Nothing has changed from the original scope.
                </p>
              ) : (
                <ul className="space-y-2">
                  {contract.variations.map((v) => (
                    <VariationRow
                      key={v.id}
                      v={v}
                      busy={decideVariation.isPending}
                      onDecide={(outcome, reason) =>
                        decideVariation.mutate({
                          id: contract.id,
                          variationId: v.id,
                          outcome,
                          reason,
                        })
                      }
                    />
                  ))}
                </ul>
              )}
            </section>

            {contract.project && (
              <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
                Running as site{' '}
                <button
                  className="font-medium underline"
                  onClick={() => navigate(`/admin/projects/${contract.project!.id}`)}
                >
                  {contract.project.code ?? contract.project.name}
                </button>
                , {contract.project.progressPct}% complete.
              </p>
            )}

            {actionError && <p className="text-sm text-red-600">{actionError}</p>}

            <div className="flex flex-wrap gap-2 border-t border-hairline pt-3">
              {contract.status === 'DRAFT' && (
                <Button disabled={issue.isPending} onClick={() => issue.mutate(contract.id)}>
                  Issue for signature
                </Button>
              )}
              {contract.status !== 'DRAFT' && (
                <Button variant="outline" onClick={() => void openPdf(contract.id)}>
                  <Download size={16} /> PDF
                </Button>
              )}
              {contract.signedPdfUrl && (
                <Button
                  variant="outline"
                  onClick={() => window.open(contract.signedPdfUrl!, '_blank', 'noopener')}
                >
                  Signed copy
                </Button>
              )}
              {contract.status === 'ISSUED' && (
                <Button
                  onClick={() => {
                    sign.reset();
                    setSigning(true);
                  }}
                >
                  Record signature
                </Button>
              )}
              {!contract.projectId && contract.status !== 'DRAFT' && (
                <Button
                  onClick={() => {
                    toProject.reset();
                    setConverting(true);
                  }}
                >
                  <HardHat size={16} /> Open the site
                </Button>
              )}
            </div>
          </div>
        )}
      </Dialog>

      {/* ---- Record signature ---- */}
      <Dialog open={signing} onClose={() => setSigning(false)} title="Record signature">
        <form
          key={String(signing)}
          onSubmit={(e) => {
            e.preventDefault();
            sign.mutate({ id: contract!.id, formData: new FormData(e.currentTarget) });
          }}
          className="space-y-3"
        >
          <Field label="Date signed">
            <Input name="signedDate" type="date" defaultValue={todayISO()} required />
          </Field>
          <Field label="Scan of the executed copy (optional)">
            <Input name="signedCopy" type="file" accept=".pdf,image/*" />
          </Field>
          <p className="text-xs text-fg-subtle">
            The scan becomes the operative document. The copy we generated stays on file as the
            record of what went out for signature.
          </p>
          {sign.isError && (
            <p className="text-sm text-red-600">{errorMessage(sign.error)}</p>
          )}
          <Button type="submit" className="w-full" disabled={sign.isPending}>
            Save
          </Button>
        </form>
      </Dialog>

      {/* ---- Variation ---- */}
      <Dialog open={varying} onClose={() => setVarying(false)} title="New variation order">
        <form
          key={String(varying)}
          onSubmit={(e) => {
            e.preventDefault();
            addVariation.mutate({ id: contract!.id, formData: new FormData(e.currentTarget) });
          }}
          className="space-y-3"
        >
          <Field label="What is changing?">
            <Textarea name="description" required rows={2} autoFocus />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount (KES, excl. VAT)">
              <Input name="amount" type="number" step="0.01" inputMode="decimal" required />
            </Field>
            <Field label="Date requested">
              <Input name="requestedDate" type="date" defaultValue={todayISO()} required />
            </Field>
          </div>
          <p className="text-xs text-fg-subtle">
            Enter a negative amount for an omission. Nothing moves the contract value until the
            variation is approved.
          </p>
          <Field label="Signed instruction (optional)">
            <Input name="document" type="file" accept=".pdf,image/*" />
          </Field>
          {addVariation.isError && (
            <p className="text-sm text-red-600">{errorMessage(addVariation.error)}</p>
          )}
          <Button type="submit" className="w-full" disabled={addVariation.isPending}>
            Raise variation
          </Button>
        </form>
      </Dialog>

      {/* ---- Convert to project ---- */}
      <Dialog open={converting} onClose={() => setConverting(false)} title="Open the site">
        {contract && (
          <form
            key={String(converting)}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              toProject.mutate({
                id: contract.id,
                body: {
                  name: fd.get('name') || undefined,
                  location: fd.get('location'),
                  supervisorId: fd.get('supervisorId') || null,
                },
              });
            }}
            className="space-y-3"
          >
            <p className="text-sm text-fg-muted">
              This creates the project your supervisors will work against. The client, dates and
              contract value come from{' '}
              <span className="font-medium text-fg">{contract.contractNo}</span>.
            </p>
            <Field label="Site name">
              <Input name="name" defaultValue={contract.title} required />
            </Field>
            <Field label="Where is it?">
              <Input name="location" required placeholder="Estate, road, town" />
            </Field>
            <Field label="Supervisor (optional)">
              <Combobox
                name="supervisorId"
                placeholder="Assign later"
                aria-label="Supervisor"
                options={(team ?? [])
                  .filter((u) => u.role === 'SUPERVISOR' && u.active)
                  .map((u) => ({ value: u.id, label: u.name }))}
              />
            </Field>
            {toProject.isError && (
              <p className="text-sm text-red-600">{errorMessage(toProject.error)}</p>
            )}
            <Button type="submit" className="w-full" disabled={toProject.isPending}>
              Open the site
            </Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}

/** The money position, laid out the way the contract itself states it. */
function Position({ contract }: { contract: Contract }) {
  const p = contract.position;
  return (
    <div className="rounded-lg border border-hairline bg-surface-muted/40 p-3">
      <dl className="space-y-1.5 text-sm">
        <Row label="Original contract sum" value={p.originalValue} />
        {p.approvedVariations !== 0 && (
          <Row label="Approved variations" value={p.approvedVariations} signed />
        )}
        <div className="flex items-baseline justify-between border-t border-hairline pt-1.5">
          <dt className="font-medium text-fg">Current sum, excl. VAT</dt>
          <dd className="font-semibold tabular-nums text-fg">{fmtMoney(p.currentValue)}</dd>
        </div>
        {p.vatRatePct > 0 && <Row label={`VAT @ ${p.vatRatePct}%`} value={p.vatAmount} />}
        <Row label="Total payable" value={p.grossValue} />
      </dl>

      {p.pendingVariations !== 0 && (
        <p className="mt-2 text-xs text-amber-700">
          {fmtMoney(p.pendingVariations)} of variations are awaiting a decision and are not counted
          above.
        </p>
      )}

      <dl className="mt-3 space-y-1 border-t border-hairline pt-2 text-xs text-fg-muted">
        <div className="flex justify-between">
          <dt>Retention at {p.retentionPct}%</dt>
          <dd className="tabular-nums">{fmtMoney(p.retentionAmount)} over the job</dd>
        </div>
        <div className="flex justify-between">
          <dt>Defects liability</dt>
          <dd>
            {p.defectsLiabilityMonths} months
            {p.defectsLiabilityEnds
              ? ` · ends ${fmtDate(p.defectsLiabilityEnds)}`
              : ' · starts at practical completion'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Row({ label, value, signed }: { label: string; value: number; signed?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="tabular-nums text-fg">
        {signed && value > 0 ? '+' : ''}
        {fmtMoney(value)}
      </dd>
    </div>
  );
}

function VariationRow({
  v,
  busy,
  onDecide,
}: {
  v: Variation;
  busy: boolean;
  onDecide: (outcome: 'APPROVED' | 'REJECTED', reason?: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const tone = v.status === 'APPROVED' ? 'green' : v.status === 'REJECTED' ? 'red' : 'yellow';

  return (
    <li className="rounded-lg border border-hairline bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-fg">
            <span className="font-medium">{v.reference}</span> · {v.description}
          </p>
          <p className="mt-0.5 text-xs text-fg-subtle">
            Requested {fmtDate(v.requestedDate)}
            {v.approvedBy && ` · ${v.status.toLowerCase()} by ${v.approvedBy.name}`}
          </p>
          {v.rejectReason && <p className="mt-1 text-xs text-red-600">{v.rejectReason}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-fg">
            {v.amount > 0 ? '+' : ''}
            {fmtMoney(v.amount)}
          </p>
          <Badge tone={tone} className="mt-1 capitalize">
            {v.status.toLowerCase()}
          </Badge>
        </div>
      </div>

      {v.documentUrl && (
        <a
          href={v.documentUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-xs text-brand-700 underline"
        >
          Signed instruction
        </a>
      )}

      {v.status === 'PENDING' && !rejecting && (
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" disabled={busy} onClick={() => onDecide('APPROVED')}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
      )}

      {rejecting && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onDecide('REJECTED', String(new FormData(e.currentTarget).get('reason')));
            setRejecting(false);
          }}
          className="mt-2 space-y-2"
        >
          <Input name="reason" required autoFocus placeholder="Why is this being turned down?" />
          <div className="flex gap-1.5">
            <Button size="sm" type="submit" variant="destructive" disabled={busy}>
              Reject
            </Button>
            <Button size="sm" type="button" variant="outline" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
