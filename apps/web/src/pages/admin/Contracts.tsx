import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Download,
  FileSignature,
  HardHat,
  Link2,
  PenLine,
  Plus,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { AppUser, Contract, ContractStatus, Variation } from '@/lib/types';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { SignaturePad, type SignaturePadHandle } from '@/features/SignaturePad';

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
  const [removingAttachment, setRemovingAttachment] = useState<{
    id: string;
    field: 'boq' | 'specs';
  } | null>(null);
  const [varying, setVarying] = useState(false);
  const [converting, setConverting] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [signingLinkUrl, setSigningLinkUrl] = useState<string | null>(null);
  const [countersigning, setCountersigning] = useState(false);
  const [countersignReady, setCountersignReady] = useState(false);
  const countersignPadRef = useRef<SignaturePadHandle>(null);

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
    onSuccess: () => {
      toast.success('Contract issued. Send it to the client for signature.');
      invalidate();
    },
    onError: (e) => toast.error(errText(e, 'The contract was not issued.')),
  });

  const sign = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) =>
      api(`/contracts/${id}/sign`, { formData }),
    onSuccess: () => {
      toast.success('Contract signed. Its value and dates are now fixed.');
      invalidate();
      setSigning(false);
    },
    onError: (e) => toast.error(errText(e, 'The signature was not recorded.')),
  });

  const createSigningLink = useMutation({
    mutationFn: (id: string) =>
      api<{ token: string; expiresAt: string }>(`/contracts/${id}/signing-link`, { body: {} }),
    onSuccess: (res) => {
      const url = `${window.location.origin}/sign/${res.token}`;
      setSigningLinkUrl(url);
      // Best-effort — clipboard access can be blocked (insecure context, no
      // permission); the dialog below shows the link either way.
      navigator.clipboard?.writeText(url).catch(() => undefined);
      toast.success('Signing link copied. Share it with the client — it works for 14 days.');
    },
    onError: (e) => toast.error(errText(e, 'The signing link was not created.')),
  });

  const countersign = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { signerName: string; signatureMethod: 'TYPED' | 'DRAWN'; signatureImage?: string };
    }) => api<Contract>(`/contracts/${id}/countersign`, { body }),
    onSuccess: () => {
      toast.success('Countersigned. The executed copy now carries both signatures.');
      invalidate();
      setCountersigning(false);
    },
    onError: (e) => toast.error(errText(e, 'The countersignature was not recorded.')),
  });

  const addVariation = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) =>
      api(`/contracts/${id}/variations`, { formData }),
    onSuccess: () => {
      toast.success('Variation raised. It changes the contract sum once approved.');
      invalidate();
      setVarying(false);
    },
    onError: (e) => toast.error(errText(e, 'The variation was not raised.')),
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
    onSuccess: (_r, vars) => {
      toast.success(
        vars.outcome === 'APPROVED'
          ? 'Variation approved. The contract sum has moved.'
          : 'Variation rejected. The reason is on the record.',
      );
      invalidate();
    },
    onError: (e) => toast.error(errText(e, 'The decision was not saved.')),
  });

  const toProject = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api<{ id: string }>(`/contracts/${id}/convert-to-project`, { body }),
    onSuccess: (project) => {
      toast.success('Site created from the contract. The claim schedule came with it.');
      invalidate();
      setConverting(false);
      setOpenId(null);
      navigate(`/admin/sites/${project.id}`);
    },
    onError: (e) => toast.error(errText(e, 'The site was not created.')),
  });

  const attachProject = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      api<{ id: string }>(`/contracts/${id}/attach-project`, { body: { projectId } }),
    onSuccess: (project) => {
      toast.success('Contract linked. This site can now be claimed against.');
      invalidate();
      setAttaching(false);
      setOpenId(null);
      navigate(`/admin/sites/${project.id}`);
    },
    onError: (e) => toast.error(errText(e, 'The contract was not linked.')),
  });

  const uploadAttachments = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) =>
      api(`/contracts/${id}/attachments`, { formData }),
    onSuccess: () => {
      toast.success('Attachment uploaded.');
      invalidate();
    },
    onError: (e) => toast.error(errText(e, 'The attachment was not uploaded.')),
  });

  const removeAttachment = useMutation({
    mutationFn: ({ id, field }: { id: string; field: 'boq' | 'specs' }) =>
      api(`/contracts/${id}/attachments/${field}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Attachment removed.');
      invalidate();
      setRemovingAttachment(null);
    },
    onError: (e) => toast.error(errText(e, 'The attachment was not removed.')),
  });

  const openPdf = async (id: string) => {
    const { url } = await api<{ url: string }>(`/contracts/${id}/pdf`);
    window.open(url, '_blank', 'noopener');
  };

  const actionError = errorMessage(
    issue.error ?? decideVariation.error ?? createSigningLink.error,
  );

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
        <Empty variant="inline" icon={FileSignature}>
          <p className="font-medium text-fg">
            {status ? 'Nothing at that status' : 'No contracts yet'}
          </p>
          <p className="mt-1 max-w-sm text-fg-muted">
            Contracts are raised from an accepted quotation, which carries the client, the job
            and the priced schedule across for you.
          </p>
        </Empty>
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

            <ContractDocuments
              contract={contract}
              onOpenPdf={() => void openPdf(contract.id)}
              onUpload={(formData) => uploadAttachments.mutate({ id: contract.id, formData })}
              onRemove={(field) => setRemovingAttachment({ id: contract.id, field })}
              busy={uploadAttachments.isPending || removeAttachment.isPending}
              error={errorMessage(uploadAttachments.error ?? removeAttachment.error) ?? undefined}
            />

            {contract.clientSignerName && (
              <p className="rounded-lg bg-good-surface p-3 text-sm text-good-fg">
                Signed electronically by {contract.clientSignerName}
                {contract.clientSignedAt && ` on ${fmtDate(contract.clientSignedAt)}`}
                {contract.clientSignatureIp && ` · IP ${contract.clientSignatureIp}`}.
              </p>
            )}

            {contract.companySignerName && (
              <p className="rounded-lg bg-good-surface p-3 text-sm text-good-fg">
                Countersigned by {contract.companySignerName}
                {contract.companySignedAt && ` on ${fmtDate(contract.companySignedAt)}`}.
              </p>
            )}

            {contract.project && (
              <p className="rounded-lg bg-good-surface p-3 text-sm text-good-fg">
                Running as site{' '}
                <button
                  className="font-medium underline"
                  onClick={() => navigate(`/admin/sites/${contract.project!.id}`)}
                >
                  {contract.project.code ?? contract.project.name}
                </button>
                , {contract.project.progressPct}% complete.
              </p>
            )}

            {actionError && <p className="text-sm text-danger-fg">{actionError}</p>}

            <div className="flex flex-wrap gap-2 border-t border-hairline pt-3">
              {contract.status === 'DRAFT' && (
                <Button disabled={issue.isPending} onClick={() => issue.mutate(contract.id)}>
                  Issue for signature
                </Button>
              )}
              {contract.status === 'ISSUED' && (
                <>
                  <Button
                    variant="outline"
                    disabled={createSigningLink.isPending}
                    onClick={() => createSigningLink.mutate(contract.id)}
                  >
                    <Send size={16} /> Send for e-signature
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      sign.reset();
                      setSigning(true);
                    }}
                  >
                    Record signature (scanned copy)
                  </Button>
                </>
              )}
              {contract.status === 'SIGNED' &&
                contract.clientSignerName &&
                !contract.companySignerName && (
                  <Button onClick={() => setCountersigning(true)}>
                    <PenLine size={16} /> Countersign
                  </Button>
                )}
              {!contract.projectId && contract.status !== 'DRAFT' && (
                <>
                  {/* For jobs already running when the office came on board:
                      the site exists, it just has no contract behind it. */}
                  <Button
                    variant="outline"
                    onClick={() => {
                      attachProject.reset();
                      setAttaching(true);
                    }}
                  >
                    <Link2 size={16} /> Link an existing site
                  </Button>
                  <Button
                    onClick={() => {
                      toProject.reset();
                      setConverting(true);
                    }}
                  >
                    <HardHat size={16} /> Open the site
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Dialog>

      {/* ---- Signing link ---- */}
      <Dialog
        open={!!signingLinkUrl}
        onClose={() => setSigningLinkUrl(null)}
        title="Signing link"
      >
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            Already copied to your clipboard. Share it with the client however you normally would
            — WhatsApp, email — it works for 14 days and only once.
          </p>
          <Input readOnly value={signingLinkUrl ?? ''} onFocus={(e) => e.currentTarget.select()} />
          <Button
            className="w-full"
            variant="outline"
            onClick={() => {
              if (signingLinkUrl) void navigator.clipboard?.writeText(signingLinkUrl);
              toast.success('Copied.');
            }}
          >
            Copy again
          </Button>
        </div>
      </Dialog>

      {/* ---- Countersign ---- */}
      <Dialog
        open={countersigning}
        onClose={() => setCountersigning(false)}
        title="Countersign this contract"
      >
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            The client has already signed. Add the company&rsquo;s signature to the same document.
          </p>
          <SignaturePad ref={countersignPadRef} onReadyChange={setCountersignReady} />
          {countersign.isError && (
            <p className="text-sm text-danger-fg">{errorMessage(countersign.error)}</p>
          )}
          <Button
            className="w-full"
            disabled={!countersignReady || countersign.isPending}
            onClick={() => {
              const signature = countersignPadRef.current?.getSignature();
              if (!signature || !contract) return;
              countersign.mutate({ id: contract.id, body: signature });
            }}
          >
            {countersign.isPending ? 'Saving…' : 'Countersign'}
          </Button>
        </div>
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
            <p className="text-sm text-danger-fg">{errorMessage(sign.error)}</p>
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
            <p className="text-sm text-danger-fg">{errorMessage(addVariation.error)}</p>
          )}
          <Button type="submit" className="w-full" disabled={addVariation.isPending}>
            Raise variation
          </Button>
        </form>
      </Dialog>

      {/* ---- Convert to site ---- */}
      {/* ---- Link an existing site ---- */}
      <Dialog
        open={attaching}
        onClose={() => setAttaching(false)}
        title="Link an existing site"
        className="max-w-lg"
      >
        {contract && (
          <AttachProjectForm
            contractId={contract.id}
            contractNo={contract.contractNo}
            clientName={contract.client.name}
            pending={attachProject.isPending}
            error={attachProject.error}
            onSubmit={(projectId) => attachProject.mutate({ id: contract.id, projectId })}
          />
        )}
      </Dialog>

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
              This creates the site your supervisors will work against. The client, dates and
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
              <p className="text-sm text-danger-fg">{errorMessage(toProject.error)}</p>
            )}
            <Button type="submit" className="w-full" disabled={toProject.isPending}>
              Open the site
            </Button>
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={Boolean(removingAttachment)}
        onClose={() => {
          setRemovingAttachment(null);
          removeAttachment.reset();
        }}
        title="Remove this attachment?"
        description={
          removingAttachment
            ? `The ${
                removingAttachment.field === 'boq' ? 'priced bill of quantities' : 'specification'
              } will be deleted from the contract file and from storage. Upload it again if you need it back.`
            : undefined
        }
        confirmLabel="Remove file"
        pending={removeAttachment.isPending}
        error={
          removeAttachment.isError
            ? errText(removeAttachment.error, 'The attachment was not removed.')
            : null
        }
        onConfirm={() => removingAttachment && removeAttachment.mutate(removingAttachment)}
      />
    </div>
  );
}

/**
 * The four documents that make up a contract file: the copy we generated, the
 * executed scan, the priced BOQ and the specification.
 *
 * They are listed together, present or not, because the useful question is
 * "what is missing from this file" — a page that only renders what exists
 * cannot answer it.
 */
function ContractDocuments({
  contract,
  onOpenPdf,
  onUpload,
  onRemove,
  busy,
  error,
}: {
  contract: Contract;
  onOpenPdf: () => void;
  onUpload: (formData: FormData) => void;
  onRemove: (field: 'boq' | 'specs') => void;
  busy: boolean;
  error?: string;
}) {
  const uploadField = (field: 'boq' | 'specs', file: File) => {
    const fd = new FormData();
    fd.set(field, file);
    onUpload(fd);
  };

  const rows: {
    key: string;
    label: string;
    hint: string;
    url: string | null;
    onView?: () => void;
    field?: 'boq' | 'specs';
  }[] = [
    {
      key: 'generated',
      label: 'Contract',
      hint: 'Generated from the agreed figures',
      url: contract.status === 'DRAFT' ? null : (contract.generatedPdfUrl ?? 'pending'),
      onView: onOpenPdf,
    },
    {
      key: 'signed',
      label: 'Signed copy',
      hint: 'Scan of the executed original',
      url: contract.signedPdfUrl,
      onView: () => window.open(contract.signedPdfUrl!, '_blank', 'noopener'),
    },
    {
      key: 'boq',
      label: 'Bill of quantities',
      hint: 'The priced schedule the claims are measured against',
      url: contract.boqUrl,
      onView: () => window.open(contract.boqUrl!, '_blank', 'noopener'),
      field: 'boq',
    },
    {
      key: 'specs',
      label: 'Specifications',
      hint: 'What "finished" means for each trade',
      url: contract.specsUrl,
      onView: () => window.open(contract.specsUrl!, '_blank', 'noopener'),
      field: 'specs',
    },
  ];

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-fg">Contract documents</h3>
      <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">{r.label}</p>
              <p className="truncate text-xs text-fg-subtle">{r.hint}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {r.url ? (
                <>
                  <Button size="sm" variant="outline" onClick={r.onView}>
                    <Download size={14} /> View
                  </Button>
                  {r.field && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onRemove(r.field!)}
                      aria-label={`Remove ${r.label}`}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </>
              ) : r.field ? (
                <label
                  className={cn(
                    buttonVariants({ size: 'sm', variant: 'outline' }),
                    'cursor-pointer',
                    busy && 'pointer-events-none opacity-50',
                  )}
                >
                  <Upload size={14} /> Upload
                  <input
                    type="file"
                    className="sr-only"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadField(r.field!, file);
                      e.target.value = '';
                    }}
                  />
                </label>
              ) : (
                <span className="text-xs text-fg-subtle">Not yet</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm text-danger-fg">{error}</p>}
    </section>
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
        <p className="mt-2 text-xs text-warn-fg">
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
          {v.rejectReason && <p className="mt-1 text-xs text-danger-fg">{v.rejectReason}</p>}
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

/**
 * Linking a contract to a site that already exists.
 *
 * The list is deliberately narrow — sites with no contract of their own, for
 * this client or not yet tied to one — because attaching a contract to the
 * wrong site misreports who owes the money on both sides of the ledger.
 */
function AttachProjectForm({
  contractId,
  contractNo,
  clientName,
  pending,
  error,
  onSubmit,
}: {
  contractId: string;
  contractNo: string | null;
  clientName: string;
  pending: boolean;
  error: unknown;
  onSubmit: (projectId: string) => void;
}) {
  const [projectId, setProjectId] = useState('');
  const { data: projects, isLoading } = useQuery({
    queryKey: ['contract', contractId, 'attachable'],
    queryFn: () =>
      api<
        {
          id: string;
          code: string | null;
          name: string;
          clientName: string;
          location: string;
          startDate: string;
          contractValue: number;
        }[]
      >(`/contracts/${contractId}/attachable-projects`),
  });

  if (isLoading) return <p className="py-6 text-center text-sm text-fg-muted">Loading sites…</p>;

  if (projects?.length === 0) {
    return (
      <div className="space-y-3">
        <Empty variant="inline" icon={HardHat}>
          <p className="font-medium text-fg">No site to link</p>
          <p className="mt-1 max-w-sm text-fg-muted">
            Every one of {clientName}&rsquo;s sites already has a contract, or belongs to another
            client. Use <span className="font-medium text-fg">Open the site</span> to create a new
            one from this contract.
          </p>
        </Empty>
      </div>
    );
  }

  const chosen = projects?.find((p) => p.id === projectId);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(projectId);
      }}
      className="space-y-3"
    >
      <p className="text-sm text-fg-muted">
        For work that was already running before {contractNo ?? 'this contract'} existed. The site
        keeps its history — attendance, expenses, photos — and gains the contract behind it, so
        progress claims, retention and the contract position start working.
      </p>

      <Field label="Which site?">
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
          <option value="">Choose a site…</option>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code ? `${p.code} · ` : ''}
              {p.name} — {p.location}
            </option>
          ))}
        </Select>
      </Field>

      {chosen && (
        <div className="rounded-lg border border-hairline bg-surface-muted p-3 text-sm">
          <p className="text-fg-muted">
            Started {fmtDate(chosen.startDate)} · currently recorded at{' '}
            <span className="tabular-nums">{fmtMoney(chosen.contractValue)}</span>
          </p>
          <p className="mt-1.5 text-xs text-fg-subtle">
            The contract sum replaces that figure — from here on the contract is what the job is
            worth.
          </p>
        </div>
      )}

      {error != null && <p className="text-sm text-danger-fg">{errorMessage(error)}</p>}

      <Button type="submit" className="w-full" disabled={!projectId || pending}>
        {pending ? 'Linking…' : 'Link this site'}
      </Button>
    </form>
  );
}
