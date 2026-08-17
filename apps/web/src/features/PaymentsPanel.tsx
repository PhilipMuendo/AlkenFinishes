import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import type { Health, Invoice, Payment, PaymentMethod, PaymentsSummary } from '@/lib/types';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormError } from '@/components/ui/form-error';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge, HealthBadge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, Td, Th, Empty } from '@/components/ui/table';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank Transfer',
  MPESA: 'M-Pesa',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};

/** Methods where the money moved through a system that issues a reference. */
const NEEDS_REFERENCE: PaymentMethod[] = ['BANK_TRANSFER', 'MPESA', 'CHEQUE'];

export function PaymentsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [deleting, setDeleting] = useState<Payment | null>(null);
  const toast = useToast();

  const { data: summary } = useQuery({
    queryKey: queryKeys.payments.summary(projectId),
    queryFn: () => api<PaymentsSummary>(`/projects/${projectId}/payments/summary`),
  });

  // Open invoices, so a payment can be applied to what it actually settles.
  const { data: invoices } = useQuery({
    queryKey: queryKeys.invoices.byProject(projectId),
    queryFn: () => api<Invoice[]>(`/projects/${projectId}/invoices`),
  });
  const openInvoices = (invoices ?? []).filter(
    (i) => i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID',
  );

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.payments.summary(projectId) });
    // One key now covers the project list, the register and every invoice
    // detail — previously this had to name `['invoices']` and `['invoice']`
    // separately, and the second never matched anything.
    void qc.invalidateQueries({ queryKey: queryKeys.invoices.all() });
    void qc.invalidateQueries({ queryKey: queryKeys.analytics.company() });
  };

  const createPayment = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/payments`, { formData }),
    onSuccess: () => {
      invalidateAll();
      setAddOpen(false);
    },
  });

  const deletePayment = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/payments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateAll();
      toast.success('Payment deleted');
      setDeleting(null);
    },
  });

  const voidPayment = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/projects/${projectId}/payments/${id}/void`, { body: { reason } }),
    onSuccess: () => {
      invalidateAll();
      setVoiding(null);
    },
  });

  const hasDeposit = !!summary?.deposit;
  const percentPaid =
    summary && summary.contractValue > 0 ? (summary.totalPaid / summary.contractValue) * 100 : 0;

  const openDialog = () => {
    setInvoiceId('');
    setAmount('');
    setMethod('BANK_TRANSFER');
    setAddOpen(true);
  };

  /** Selecting an invoice prefills the remaining balance; partial = overwrite it. */
  const onPickInvoice = (id: string) => {
    setInvoiceId(id);
    const inv = openInvoices.find((i) => i.id === id);
    setAmount(inv ? String(inv.balance) : '');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Contract &amp; deposit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="nums text-lg font-semibold text-fg">
            {fmtMoney(summary?.contractValue ?? 0)}
          </p>
          {summary?.deposit ? (
            <div className="text-sm">
              <p className="text-fg">
                Deposit paid:{' '}
                <span className="font-medium">{fmtMoney(Number(summary.deposit.amount))}</span> via{' '}
                {METHOD_LABEL[summary.deposit.method]} on {fmtDate(summary.deposit.paymentDate)}
              </p>
              {summary.deposit.notes && (
                <p className="mt-1 text-xs text-fg-muted">{summary.deposit.notes}</p>
              )}
              <ReceiptLinks payment={summary.deposit} className="mt-1" placeholder={false} />
            </div>
          ) : (
            <p className="text-sm text-fg-muted">No deposit recorded yet</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Balance on contract</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="nums text-2xl font-semibold text-fg">
            {fmtMoney(summary?.pendingBalance ?? 0)}
          </p>
          <Progress value={percentPaid} health="GREEN" />
          <p className="text-xs text-fg-muted">
            {fmtMoney(summary?.totalPaid ?? 0)} received of {fmtMoney(summary?.contractValue ?? 0)}
          </p>

          {/* Two different numbers that will rarely agree: the headline is
              everything still owed on the job, including work not yet invoiced. */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-hairline pt-3 text-xs sm:grid-cols-4">
            <Stat label="Invoiced" value={summary?.invoicedNet ?? 0} />
            <Stat label="Outstanding on invoices" value={summary?.arOutstanding ?? 0} />
            <Stat
              label="Overdue"
              value={summary?.arOverdue ?? 0}
              tone={summary && summary.arOverdue > 0 ? 'negative' : undefined}
            />
            <Stat label="Retention held" value={summary?.retentionHeld ?? 0} />
          </dl>

          {summary && (
            /* Keyed on the stored value so a save (or a project switch)
               reseeds the field from the server, without an effect racing
               whatever the user is typing. */
            <BalanceDueDateForm
              key={summary.balanceDueDate ?? 'unset'}
              projectId={projectId}
              initial={summary.balanceDueDate ? summary.balanceDueDate.slice(0, 10) : ''}
              health={summary.dueDateHealth}
              onSaved={invalidateAll}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={openDialog}>
          <Plus size={16} /> Record payment
        </Button>
      </div>

      {summary && summary.installments.length === 0 ? (
        <Empty>No subsequent payments recorded yet</Empty>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Method</Th>
                <Th className="text-right">Amount</Th>
                <Th>Invoice</Th>
                <Th>Documents</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {summary?.installments.map((p) => (
                <tr key={p.id} className={p.voidedAt ? 'opacity-55' : undefined}>
                  <Td className="whitespace-nowrap">{fmtDate(p.paymentDate)}</Td>
                  <Td>
                    {METHOD_LABEL[p.method]}
                    {p.referenceNo && (
                      <p className="text-xs text-fg-subtle">
                        {p.bankName ? `${p.bankName} · ` : ''}
                        {p.referenceNo}
                      </p>
                    )}
                  </Td>
                  <Td className={`nums text-right font-medium ${p.voidedAt ? 'line-through' : ''}`}>
                    {fmtMoney(Number(p.amount))}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {p.invoice?.invoiceNo ?? <span className="text-fg-subtle">On account</span>}
                  </Td>
                  <Td>
                    {p.voidedAt ? <Badge tone="slate">Voided</Badge> : <ReceiptLinks payment={p} />}
                  </Td>
                  <Td className="text-right">
                    {p.voidedAt ? (
                      <span className="text-xs text-fg-subtle">{p.voidReason}</span>
                    ) : p.receiptNo ? (
                      <Button size="sm" variant="outline" onClick={() => setVoiding(p)}>
                        Void
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeleting(p)}
                        // Only this row's button greys out — one shared
                        // `isPending` disabled every Delete in the table.
                        disabled={deletePayment.isPending && deletePayment.variables === p.id}
                      >
                        Delete
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Record payment">
        <form
          key={String(addOpen)}
          onSubmit={(e) => {
            e.preventDefault();
            createPayment.mutate(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <Field label="Apply to">
            <Select
              name="invoiceId"
              value={invoiceId}
              onChange={(e) => onPickInvoice(e.target.value)}
            >
              <option value="">Not against an invoice (on account)</option>
              {openInvoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoiceNo} · balance {fmtMoney(i.balance)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select name="type" required defaultValue={hasDeposit ? 'INSTALLMENT' : 'DEPOSIT'}>
              <option value="DEPOSIT" disabled={hasDeposit}>
                Deposit{hasDeposit ? ' (already recorded)' : ''}
              </option>
              <option value="INSTALLMENT">Subsequent payment</option>
            </Select>
          </Field>
          <Field label="Amount (KES)">
            <Input
              name="amount"
              type="number"
              min="1"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </Field>
          <Field label="Method">
            <Select
              name="method"
              required
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            >
              {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bank / M-Pesa till (optional)">
              <Input name="bankName" placeholder="e.g. Equity Bank" />
            </Field>
            <Field
              label={
                NEEDS_REFERENCE.includes(method)
                  ? 'Transaction reference'
                  : 'Transaction reference (optional)'
              }
            >
              <Input
                name="referenceNo"
                placeholder="EFT ref / M-Pesa code / cheque no."
                required={NEEDS_REFERENCE.includes(method)}
              />
            </Field>
          </div>
          <Field label="Date">
            <Input name="paymentDate" type="date" defaultValue={todayISO()} required />
          </Field>
          <Field label="Notes (optional)">
            <Textarea name="notes" placeholder="e.g. Second installment on completion of roofing" />
          </Field>
          {/* This is the CLIENT's proof they sent the money. Our own numbered
              receipt is generated automatically on save — see ReceiptLinks. */}
          <Field label="Client's proof of payment — bank slip (optional)">
            <Input name="receipt" type="file" accept="image/*,.pdf" capture="environment" />
          </Field>
          <p className="text-xs text-fg-subtle">
            An official numbered receipt is generated automatically once you save.
          </p>
          <FormError error={createPayment.error} fallback="Failed to save payment" />
          <Button type="submit" size="lg" className="w-full" disabled={createPayment.isPending}>
            Save payment
          </Button>
        </form>
      </Dialog>

      <Dialog
        open={!!voiding}
        onClose={() => {
          setVoiding(null);
          voidPayment.reset();
        }}
        title={voiding ? `Void receipt ${voiding.receiptNo}?` : ''}
      >
        {voiding && (
          <form
            key={voiding.id}
            onSubmit={(e) => {
              e.preventDefault();
              const reason = new FormData(e.currentTarget).get('reason') as string;
              voidPayment.mutate({ id: voiding.id, reason });
            }}
            className="space-y-3"
          >
            <p className="text-sm text-fg-muted">
              This reverses{' '}
              <span className="font-medium text-fg">{fmtMoney(Number(voiding.amount))}</span> from
              collections and reopens any invoice it settled. The receipt number stays on record so
              the series is not broken.
            </p>
            <Textarea
              name="reason"
              required
              minLength={3}
              placeholder="Why is this being voided?"
            />
            <FormError error={voidPayment.error} fallback="Failed to void this payment" />
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
                disabled={voidPayment.isPending}
              >
                Void payment
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deletePayment.mutate(deleting.id)}
        title="Delete this payment?"
        confirmLabel="Delete payment"
        pending={deletePayment.isPending}
        error={deletePayment.error}
        body={
          deleting && (
            <>
              <strong className="font-medium text-fg">{fmtMoney(Number(deleting.amount))}</strong>{' '}
              recorded on {fmtDate(deleting.paymentDate)} will be removed, and the contract balance
              will go back up by that amount. This cannot be undone.
            </>
          )
        }
      />
    </div>
  );
}

/**
 * The two documents on a payment, deliberately labelled apart: ours (numbered,
 * generated) and theirs (uploaded proof). Conflating them is the confusion this
 * whole feature exists to remove.
 *
 * `placeholder` controls the empty case: a table cell wants a dash to keep the
 * column aligned, but inline under the deposit line a bare dash reads as a
 * mistake, so there it renders nothing.
 */
function ReceiptLinks({
  payment,
  className,
  placeholder = true,
}: {
  payment: Payment;
  className?: string;
  placeholder?: boolean;
}) {
  if (!payment.receiptPdfUrl && !payment.receiptUrl) {
    return placeholder ? <span className="text-fg-subtle">—</span> : null;
  }
  return (
    <div className={`flex flex-col gap-0.5 text-xs ${className ?? ''}`}>
      {payment.receiptPdfUrl && (
        <a
          href={payment.receiptPdfUrl}
          target="_blank"
          rel="noreferrer"
          title={payment.receiptNo ?? undefined}
          className="inline-flex items-center gap-1 text-brand-700 hover:underline"
        >
          <Receipt size={12} /> Official receipt
        </a>
      )}
      {payment.receiptUrl && (
        <a
          href={payment.receiptUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-fg-muted hover:underline"
        >
          <FileText size={12} /> Client slip
        </a>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'negative' }) {
  return (
    <div>
      <dt className="text-fg-subtle">{label}</dt>
      <dd
        className={cn(
          'nums font-medium',
          tone === 'negative' && value > 0 ? 'text-red-600' : 'text-fg',
        )}
      >
        {fmtMoney(value)}
      </dd>
    </div>
  );
}

/**
 * The contractual balance due date. Its own component so the input can be
 * seeded by `useState` from the loaded summary rather than by an effect that
 * would overwrite what the user is typing on every background refetch.
 */
function BalanceDueDateForm({
  projectId,
  initial,
  health,
  onSaved,
}: {
  projectId: string;
  initial: string;
  health: Health;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [dueDate, setDueDate] = useState(initial);

  const save = useMutation({
    mutationFn: () =>
      api(`/projects/${projectId}/payments/due-date`, {
        method: 'PUT',
        body: { balanceDueDate: dueDate || null },
      }),
    onSuccess: () => {
      toast.success('Balance due date saved');
      onSaved();
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Balance due date (as per contract)">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Save due date
        </Button>
        <HealthBadge health={health} />
      </div>
      <FormError error={save.error} fallback="Failed to save the due date" />
    </div>
  );
}
