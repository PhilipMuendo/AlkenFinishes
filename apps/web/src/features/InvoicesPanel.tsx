import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { Invoice, InvoiceStatus, InvoicingConfig, ProjectReceivables } from '@/lib/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormError } from '@/components/ui/form-error';
import { useToast } from '@/components/ui/toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { Textarea } from '@/components/ui/input';
import { INVOICE_TYPE_LABEL, InvoiceEditor, type InvoicePayload } from './InvoiceEditor';
import { InvoiceDetail } from './InvoiceDetail';

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PARTIALLY_PAID: 'Part paid',
  PAID: 'Paid',
  VOID: 'Void',
};

export function InvoiceStatusBadge({ invoice }: { invoice: Pick<Invoice, 'status' | 'overdue'> }) {
  if (invoice.status !== 'VOID' && invoice.overdue) return <Badge tone="red">Overdue</Badge>;
  const tone =
    invoice.status === 'PAID'
      ? 'green'
      : invoice.status === 'PARTIALLY_PAID'
        ? 'yellow'
        : invoice.status === 'ISSUED'
          ? 'blue'
          : 'slate';
  return <Badge tone={tone}>{STATUS_LABEL[invoice.status]}</Badge>;
}

export function InvoicesPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState<Invoice | null>(null);
  const toast = useToast();

  const { data: invoices, isLoading } = useQuery({
    queryKey: queryKeys.invoices.byProject(projectId),
    queryFn: () => api<Invoice[]>(`/projects/${projectId}/invoices`),
  });
  const { data: summary } = useQuery({
    queryKey: queryKeys.invoices.summary(projectId),
    queryFn: () => api<ProjectReceivables>(`/projects/${projectId}/invoices/summary`),
  });
  const { data: config } = useQuery({
    queryKey: queryKeys.settings.invoicing(),
    queryFn: () => api<InvoicingConfig>('/settings/invoicing'),
  });

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.invoices.all() });
    void qc.invalidateQueries({ queryKey: queryKeys.payments.summary(projectId) });
    void qc.invalidateQueries({ queryKey: queryKeys.analytics.company() });
  };

  const create = useMutation({
    mutationFn: (body: InvoicePayload) => api(`/projects/${projectId}/invoices`, { body }),
    onSuccess: () => {
      invalidateAll();
      setAddOpen(false);
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: InvoicePayload }) =>
      api(`/projects/${projectId}/invoices/${id}`, { method: 'PUT', body }),
    onSuccess: () => {
      invalidateAll();
      setEditing(null);
    },
  });

  const issue = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/invoices/${id}/issue`, { body: {} }),
    onSuccess: invalidateAll,
  });

  const voidInvoice = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/projects/${projectId}/invoices/${id}/void`, { body: { reason } }),
    onSuccess: () => {
      invalidateAll();
      setVoiding(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/invoices/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateAll();
      toast.success('Draft invoice deleted');
      setDeleting(null);
    },
  });

  const defaults = {
    vatRatePct: config?.vatRatePct ?? 16,
    retentionRatePct: config?.defaultRetentionPct ?? 0,
    paymentTermsDays: config?.defaultPaymentTermsDays ?? 30,
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile
          label="Outstanding on invoices"
          value={summary?.arOutstanding ?? 0}
          hint="Billed and not yet paid"
        />
        <SummaryTile
          label="Overdue"
          value={summary?.arOverdue ?? 0}
          hint={
            summary?.oldestOverdueDays
              ? `Oldest is ${summary.oldestOverdueDays} days past due`
              : 'Nothing past its due date'
          }
          tone={summary && summary.arOverdue > 0 ? 'negative' : undefined}
        />
        <SummaryTile
          label="Retention held"
          value={summary?.retentionHeld ?? 0}
          hint="Withheld pending defects liability"
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={16} /> New invoice
        </Button>
      </div>

      {!isLoading && invoices?.length === 0 ? (
        <Card>
          <CardContent>
            <Empty icon={FileText}>
              <p className="font-medium text-fg">No invoices yet</p>
              <p className="mt-1 max-w-xs text-fg-muted">
                Raise a progress claim to bill the client for work completed so far.
              </p>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Type</Th>
                <Th>Issued</Th>
                <Th>Due</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Balance</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {invoices?.map((inv) => (
                <tr key={inv.id} className={inv.status === 'VOID' ? 'opacity-55' : undefined}>
                  <Td>
                    <button
                      onClick={() => setViewing(inv.id)}
                      className="font-medium text-fg hover:underline"
                    >
                      {inv.invoiceNo ?? 'Draft'}
                    </button>
                    {inv.title && inv.title !== INVOICE_TYPE_LABEL[inv.type] && (
                      <p className="text-xs text-fg-subtle">{inv.title}</p>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{INVOICE_TYPE_LABEL[inv.type]}</Td>
                  <Td className="whitespace-nowrap">{fmtDate(inv.issueDate)}</Td>
                  <Td className="whitespace-nowrap">
                    {fmtDate(inv.dueDate)}
                    {inv.overdue && inv.status !== 'VOID' && (
                      <p className="text-xs text-red-600">{inv.daysOverdue}d late</p>
                    )}
                  </Td>
                  <Td className="nums text-right">{fmtMoney(inv.netPayable)}</Td>
                  <Td className="nums text-right font-medium">
                    {inv.status === 'VOID' ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      fmtMoney(inv.balance)
                    )}
                  </Td>
                  <Td>
                    <InvoiceStatusBadge invoice={inv} />
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {inv.status === 'DRAFT' ? (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setEditing(inv)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => issue.mutate(inv.id)}
                            disabled={issue.isPending}
                          >
                            Issue
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleting(inv)}
                            // Per-row: one shared `isPending` greyed out every
                            // Delete button in the table at once.
                            disabled={remove.isPending && remove.variables === inv.id}
                          >
                            Delete
                          </Button>
                        </>
                      ) : (
                        <>
                          {inv.pdfUrl && (
                            <a href={inv.pdfUrl} target="_blank" rel="noreferrer">
                              <Button size="sm" variant="outline">
                                PDF
                              </Button>
                            </a>
                          )}
                          {inv.status !== 'VOID' && inv.amountPaid === 0 && (
                            <Button size="sm" variant="ghost" onClick={() => setVoiding(inv)}>
                              Void
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <FormError error={issue.error} fallback="Failed to issue invoice" />
      <FormError error={remove.error} fallback="Failed to delete draft" />

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="New invoice"
        className="max-w-3xl"
      >
        {addOpen && (
          <InvoiceEditor
            defaults={defaults}
            submitting={create.isPending}
            onSubmit={(body) => create.mutate(body)}
            error={<FormError error={create.error} fallback="Failed to save this invoice" />}
          />
        )}
      </Dialog>

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Edit draft${editing.title ? ` — ${editing.title}` : ''}` : ''}
        className="max-w-3xl"
      >
        {editing && (
          <InvoiceEditor
            key={editing.id}
            existing={editing}
            defaults={defaults}
            submitting={update.isPending}
            onSubmit={(body) => update.mutate({ id: editing.id, body })}
            error={<FormError error={update.error} fallback="Failed to save changes" />}
          />
        )}
      </Dialog>

      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        title="Invoice"
        className="max-w-3xl"
      >
        {viewing && <InvoiceDetail projectId={projectId} invoiceId={viewing} />}
      </Dialog>

      <Dialog
        open={!!voiding}
        onClose={() => {
          setVoiding(null);
          voidInvoice.reset();
        }}
        title={voiding ? `Void ${voiding.invoiceNo}?` : ''}
      >
        {voiding && (
          <form
            key={voiding.id}
            onSubmit={(e) => {
              e.preventDefault();
              const reason = new FormData(e.currentTarget).get('reason') as string;
              voidInvoice.mutate({ id: voiding.id, reason });
            }}
            className="space-y-3"
          >
            <p className="text-sm text-fg-muted">
              Voiding keeps <span className="font-medium text-fg">{voiding.invoiceNo}</span> and its
              number on record so the series stays unbroken — it is cancelled, not deleted. The
              reason is stored in the audit log.
            </p>
            <Textarea
              name="reason"
              required
              minLength={3}
              placeholder="Why is this being voided?"
            />
            <FormError error={voidInvoice.error} fallback="Failed to void this invoice" />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setVoiding(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                className="flex-1"
                disabled={voidInvoice.isPending}
              >
                Void invoice
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Only drafts can be deleted — an issued invoice is voided instead, so
          its number stays on record and the series is never broken. */}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        title="Delete this draft?"
        confirmLabel="Delete draft"
        pending={remove.isPending}
        error={remove.error}
        body={
          deleting && (
            <>
              This draft{deleting.title ? ` — ${deleting.title}` : ''} for{' '}
              <strong className="font-medium text-fg">{fmtMoney(deleting.netPayable)}</strong> will
              be deleted. It has not been issued, so nothing on the client&rsquo;s account changes.
            </>
          )
        }
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: 'negative';
}) {
  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={`nums text-xl font-semibold ${
            tone === 'negative' && value > 0 ? 'text-red-600' : 'text-fg'
          }`}
        >
          {fmtMoney(value)}
        </p>
        <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p>
      </CardContent>
    </Card>
  );
}
