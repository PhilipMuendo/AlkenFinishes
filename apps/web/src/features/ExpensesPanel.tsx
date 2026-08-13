import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Plus, Receipt, ScanLine, Trash2, Wallet } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type {
  Expense,
  ScanFailure,
  ScannedReceipt,
  ExpenseCategory,
  ExpenseStatus,
  PurchaseTaxConfig,
  Supplier,
} from '@/lib/types';
import { SupplierPaymentDialog } from './SupplierPaymentDialog';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { Notice } from '@/components/ui/notice';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'MATERIALS', label: 'Materials' },
  { value: 'LABOUR', label: 'Labour (cash payout)' },
  { value: 'TRANSPORT', label: 'Transport' },
  { value: 'EQUIPMENT_HIRE', label: 'Equipment hire' },
  { value: 'SUBCONTRACTOR', label: 'Subcontractor' },
  { value: 'SITE_OVERHEADS', label: 'Site overheads' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_TONE: Record<ExpenseStatus, 'yellow' | 'green' | 'red'> = {
  PENDING: 'yellow',
  APPROVED: 'green',
  REJECTED: 'red',
};

export function ExpensesPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canBrowse = user?.role === 'SUPERADMIN';
  const [open, setOpen] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [rejecting, setRejecting] = useState<Expense | null>(null);
  const [paying, setPaying] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  // The supplier list and tax defaults are office-only, and are what turn a
  // plain expense into a bill with a balance.
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<Supplier[]>('/suppliers'),
    enabled: canBrowse,
  });
  const { data: tax } = useQuery({
    queryKey: ['settings', 'purchase-tax'],
    queryFn: () => api<PurchaseTaxConfig>('/settings/purchase-tax'),
    enabled: canBrowse,
  });

  const { data: expenses } = useQuery({
    queryKey: ['expenses', projectId],
    queryFn: () => api<Expense[]>(`/projects/${projectId}/expenses`),
    enabled: canBrowse,
  });
  const { data: mine } = useQuery({
    queryKey: ['expenses', projectId, 'mine'],
    queryFn: () => api<Expense[]>(`/projects/${projectId}/expenses/mine`),
    enabled: !canBrowse,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['expenses', projectId] });
    void qc.invalidateQueries({ queryKey: ['analytics', 'project', projectId] });
    void qc.invalidateQueries({ queryKey: ['analytics', 'company'] });
  };

  const create = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/expenses`, { formData }),
    onSuccess: () => {
      toast.success(
        canBrowse ? 'Expense logged.' : 'Expense submitted. The office will review it.',
      );
      invalidate();
      setOpen(false);
      if (!canBrowse) {
        setJustSubmitted(true);
        setTimeout(() => setJustSubmitted(false), 5000);
      }
    },
  });

  const approve = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/expenses/${id}/approve`, { body: {} }),
    onSuccess: () => {
      toast.success('Expense approved. It now counts against the budget and is owed to the supplier.');
      invalidate();
    },
    onError: (e) => toast.error(errText(e, 'The expense was not approved.')),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/projects/${projectId}/expenses/${id}/reject`, { body: { reason } }),
    onSuccess: () => {
      toast.success('Expense rejected. The reason is on the record.');
      invalidate();
      setRejecting(null);
    },
    onError: (e) => toast.error(errText(e, 'The expense was not rejected.')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/expenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Expense deleted.');
      invalidate();
      setDeleting(null);
    },
    onError: (e) => toast.error(errText(e, 'The expense was not deleted.')),
  });

  // Supervisors can log a purchase (money leaves their hand on site and needs
  // a receipt captured there) but don't get the project's full ledger — that's
  // office-only. They see their own claims and whether the office accepted
  // them, so a rejection doesn't vanish without a trace.
  if (!canBrowse) {
    return (
      <div className="space-y-4">
        {justSubmitted && (
          <div className="flex items-center gap-2 rounded-xl border border-good-hairline bg-good-surface px-4 py-3 text-sm text-good-fg">
            <CheckCircle2 size={18} className="shrink-0 text-good-fg" />
            Expense recorded and sent to the office.
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> Record expense
          </Button>
        </div>

        {mine?.length === 0 ? (
          <Card>
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <Receipt size={28} className="text-fg-subtle" />
              <p className="font-medium text-fg">No expenses logged yet</p>
              <p className="max-w-xs text-sm text-fg-muted">
                Record what you spent and attach a receipt. The office reviews it from here.
              </p>
            </div>
          </Card>
        ) : (
          <div className="space-y-2">
            {mine?.map((e) => (
              <Card key={e.id} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-fg">{e.description}</p>
                    <p className="text-xs text-fg-subtle">
                      {fmtDate(e.expenseDate)} ·{' '}
                      {CATEGORIES.find((c) => c.value === e.expenseCategory)?.label}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums text-fg">{fmtMoney(e.amount)}</p>
                    <Badge tone={STATUS_TONE[e.status]} className="mt-1 capitalize">
                      {e.status.toLowerCase()}
                    </Badge>
                  </div>
                </div>
                {e.rejectReason && (
                  <p className="mt-2 text-xs text-danger-fg">Declined: {e.rejectReason}</p>
                )}
              </Card>
            ))}
          </div>
        )}

        <Dialog open={open} onClose={() => setOpen(false)} title="Record expense">
          <ExpenseForm
            projectId={projectId}
            onSubmit={(fd) => create.mutate(fd)}
            pending={create.isPending}
            error={create.error}
          />
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> Record expense
        </Button>
      </div>

      {expenses?.length === 0 ? (
        <Empty>No expenses recorded for this project</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Category</Th>
              <Th>Description</Th>
              <Th className="text-right">Amount</Th>
              <Th>Supplier</Th>
              <Th className="text-right">Owed</Th>
              <Th>Status</Th>
              <Th>Receipt</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {expenses?.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap">{fmtDate(e.expenseDate)}</Td>
                <Td>
                  <Badge>{CATEGORIES.find((c) => c.value === e.expenseCategory)?.label ?? e.expenseCategory}</Badge>
                </Td>
                <Td>
                  {e.description}
                  <p className="text-xs text-fg-subtle">
                    {e.submittedBy.name}
                    {e.dueDate && ` · due ${fmtDate(e.dueDate)}`}
                  </p>
                </Td>
                <Td className="text-right font-medium tabular-nums">
                  {fmtMoney(e.amount)}
                  {e.vatAmount > 0 && (
                    <p className="text-xs font-normal text-fg-subtle">
                      incl. {fmtMoney(e.vatAmount)} VAT
                    </p>
                  )}
                </Td>
                <Td>
                  {e.supplier ? (
                    <>
                      <p className="text-fg">{e.supplier.name}</p>
                      {e.supplierInvoiceNo && (
                        <p className="text-xs text-fg-subtle">{e.supplierInvoiceNo}</p>
                      )}
                    </>
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </Td>
                {/* A cost with no supplier has no balance to show. Printing a
                    zero there would read as "paid", which is a claim we have
                    not made about petty cash. */}
                <Td className="text-right tabular-nums">
                  {e.position ? (
                    e.position.settled ? (
                      <Badge tone="green">Paid</Badge>
                    ) : (
                      <>
                        <p className={e.position.overdue ? 'font-medium text-danger-fg' : 'text-fg'}>
                          {fmtMoney(e.position.outstanding)}
                        </p>
                        <p className="text-xs text-fg-subtle">
                          {e.position.paid > 0
                            ? `${fmtMoney(e.position.paid)} settled`
                            : 'nothing paid'}
                          {e.position.overdue && ` · ${e.position.daysOverdue}d late`}
                        </p>
                      </>
                    )
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </Td>
                <Td>
                  <Badge tone={STATUS_TONE[e.status]} className="capitalize">
                    {e.status.toLowerCase()}
                  </Badge>
                  {e.rejectReason && <p className="mt-0.5 text-xs text-fg-subtle">{e.rejectReason}</p>}
                </Td>
                <Td>
                  {e.receiptUrl ? (
                    <a
                      href={e.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                    >
                      <Receipt size={14} /> View
                    </a>
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1.5">
                    {e.status === 'PENDING' && (
                      <>
                        <Button
                          size="sm"
                          disabled={approve.isPending}
                          onClick={() => approve.mutate(e.id)}
                        >
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setRejecting(e)}>
                          Reject
                        </Button>
                        <button
                          aria-label="Delete expense"
                          onClick={() => {
                            remove.reset();
                            setDeleting(e);
                          }}
                          className="rounded-lg p-1.5 text-fg-subtle transition-colors hover:bg-danger-surface hover:text-danger-fg"
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                    {/* Paying a supplier does not wait on approval: the money
                        often has to go before the office signs the claim off. */}
                    {e.position && !e.position.settled && (
                      <Button size="sm" variant="outline" onClick={() => setPaying(e)}>
                        <Wallet size={14} /> Pay
                      </Button>
                    )}
                    {e.position?.settled && e.payments.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => setPaying(e)}>
                        Payments
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete this expense?` : ''}
        description={deleting ? `${deleting.description} — this cannot be undone.` : undefined}
        pending={remove.isPending}
        error={remove.error instanceof ApiRequestError ? remove.error.message : null}
        onConfirm={() => remove.mutate(deleting!.id)}
      />

      <Dialog open={open} onClose={() => setOpen(false)} title="Record expense">
        <ExpenseForm
          projectId={projectId}
          onSubmit={(fd) => create.mutate(fd)}
          pending={create.isPending}
          error={create.error}
          suppliers={suppliers}
          tax={tax}
        />
      </Dialog>

      <Dialog
        open={!!paying}
        onClose={() => setPaying(null)}
        title="Pay supplier"
        className="max-w-2xl"
      >
        {paying && (
          <SupplierPaymentDialog
            key={paying.id}
            projectId={projectId}
            // Read back from the list so the payment history stays live after
            // one is added or removed, rather than freezing at open time.
            expense={expenses?.find((x) => x.id === paying.id) ?? paying}
            onDone={() => setPaying(null)}
          />
        )}
      </Dialog>

      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} title="Decline this claim">
        <form
          key={rejecting?.id ?? 'none'}
          onSubmit={(e) => {
            e.preventDefault();
            reject.mutate({
              id: rejecting!.id,
              reason: String(new FormData(e.currentTarget).get('reason')),
            });
          }}
          className="space-y-3"
        >
          <Field label="Why?">
            <Textarea name="reason" required rows={2} autoFocus />
          </Field>
          {reject.isError && (
            <p className="text-sm text-danger-fg">
              {reject.error instanceof ApiRequestError ? reject.error.message : 'Failed to save'}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={reject.isPending}>
            Decline claim
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

function ExpenseForm({
  onSubmit,
  pending,
  error,
  suppliers,
  tax,
  projectId,
}: {
  onSubmit: (formData: FormData) => void;
  pending: boolean;
  error: unknown;
  suppliers?: Supplier[];
  tax?: PurchaseTaxConfig;
  projectId: string;
}) {
  // A supplier is what turns this from "money already gone" into a bill with a
  // balance. Everything tax-related therefore stays hidden until one is
  // chosen — a fuel receipt should be as quick to file as it is today.
  const [supplierId, setSupplierId] = useState('');
  const onCredit = supplierId !== '';

  // What a scan suggested. It only ever prefills the fields below; the figures
  // that reach the books are the ones showing here when Save is pressed.
  const [scan, setScan] = useState<ScannedReceipt | null>(null);
  const [scanVersion, setScanVersion] = useState(0);

  const readReceipt = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.set('receipt', file);
      return api<ScannedReceipt>(`/projects/${projectId}/expenses/scan-receipt`, { formData: fd });
    },
    onSuccess: (result) => {
      setScan(result);
      // Remounting the form is what re-applies the defaults below.
      setScanVersion((v) => v + 1);
      if (result.supplier) setSupplierId(result.supplier.id);
    },
  });

  // The free allowance is gone for the day. Keep the button hidden for the
  // rest of the session rather than inviting a retry that cannot succeed.
  const scanFailure =
    readReceipt.error instanceof ApiRequestError
      ? ((readReceipt.error.details as { reason?: ScanFailure } | undefined)?.reason ?? null)
      : null;
  const outOfQuota = scanFailure === 'QUOTA_DAILY';

  return (
    <form
      key={`expense-form-${scanVersion}`}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
      }}
      className="space-y-3"
    >
      {tax?.receiptScanning && (
        <ReceiptScanner
          state={readReceipt}
          scan={scan}
          outOfQuota={outOfQuota}
          onPick={(file) => readReceipt.mutate(file)}
        />
      )}

      <Field label="Category">
        <Select name="expenseCategory" required>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Amount (KES)"
        hint={onCredit ? 'The gross figure the supplier is asking for' : undefined}
      >
        <Input
          name="amount"
          type="number"
          min="1"
          step="0.01"
          inputMode="decimal"
          required
          defaultValue={scan?.suggested.amount ?? ''}
        />
      </Field>
      <Field label="Description">
        <Textarea name="description" required placeholder="20 bags of cement" />
      </Field>
      <Field label="Date">
        <Input
          name="expenseDate"
          type="date"
          defaultValue={scan?.extracted.date ?? todayISO()}
          required
        />
      </Field>

      {suppliers && suppliers.length > 0 && (
        <Field
          label="Supplier"
          hint="Leave blank for petty cash, fuel or anything already paid for. Choosing a supplier puts this on the payables list."
        >
          <Select
            name="supplierId"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">No supplier — already paid</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {onCredit && (
        <div className="space-y-3 rounded-lg border border-hairline p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Their invoice no.">
              <Input
                name="supplierInvoiceNo"
                placeholder="INV-4471"
                defaultValue={scan?.extracted.invoiceNo ?? ''}
              />
            </Field>
            <Field label="Payment due">
              <Input name="dueDate" type="date" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="VAT rate %" hint="Zero for exempt or zero-rated supplies">
              <Input
                name="vatRatePct"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={scan?.suggested.vatRatePct ?? tax?.vatRatePct ?? 16}
              />
            </Field>
            <Field label="The amount above">
              <Select name="vatInclusive" defaultValue={tax?.billsIncludeVat ? 'true' : 'false'}>
                <option value="true">Includes VAT</option>
                <option value="false">Excludes VAT — add it on</option>
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              name="taxInvoice"
              type="checkbox"
              value="true"
              className="size-4"
              defaultChecked={scan?.extracted.taxInvoice ?? false}
            />
            They gave a proper tax invoice (ETR)
          </label>
          <p className="text-xs text-fg-subtle">
            Input VAT is only reclaimable against a valid tax invoice. Without one the VAT is
            simply part of what the job cost.
          </p>
        </div>
      )}

      <Field label="Receipt photo / document">
        <Input name="receipt" type="file" accept="image/*,.pdf" capture="environment" />
      </Field>
      {error != null && (
        <p className="text-sm text-danger-fg">
          {error instanceof ApiRequestError ? error.message : 'Failed to save expense'}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        Save expense
      </Button>
    </form>
  );
}

/**
 * Reading a receipt into the form.
 *
 * The scan SUGGESTS. What reaches the books is whatever is showing in the
 * fields when Save is pressed, and the checks below say plainly which figures
 * were verified and which were not — because "the AI read 80,000" is not a
 * reason to trust it, but "the AI read 80,000 and it is 16% of the subtotal
 * and the receipt adds up" is.
 */
function ReceiptScanner({
  state,
  scan,
  outOfQuota,
  onPick,
}: {
  state: { isPending: boolean; isError: boolean; error: unknown };
  scan: ScannedReceipt | null;
  outOfQuota: boolean;
  onPick: (file: File) => void;
}) {
  // Out of allowance for the day: say so plainly and get out of the way. An
  // enabled button that cannot work is worse than no button.
  if (outOfQuota && !scan) {
    return (
      <Notice tone="warn" icon={AlertTriangle}>
        <div className="min-w-0">
          <p className="font-medium text-fg">Today&rsquo;s free receipt reading is used up</p>
          <p className="mt-0.5 text-fg-muted">
            The allowance resets tomorrow. Fill the form in by hand for now — nothing else has
            changed.
          </p>
        </div>
      </Notice>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-hairline-strong p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">Read it off the receipt</p>
          <p className="text-xs text-fg-muted">
            Photograph the receipt and the figures below are filled in for you to check.
          </p>
        </div>
        <label className="shrink-0">
          <span
            className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-hairline-strong px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-sunken ${
              state.isPending ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            <ScanLine size={15} />
            {state.isPending ? 'Reading…' : 'Scan receipt'}
          </span>
          <input
            type="file"
            accept="image/*,.pdf"
            capture="environment"
            className="hidden"
            disabled={state.isPending || outOfQuota}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {state.isError && (
        <p className="mt-2 text-sm text-danger-fg">
          {state.error instanceof ApiRequestError
            ? state.error.message
            : 'Could not read that receipt. Enter it by hand.'}
        </p>
      )}

      {scan && (
        <div className="mt-3 space-y-2 border-t border-hairline pt-3">
          <p className="text-xs text-fg-muted">
            Filled in below — <span className="font-medium text-fg">check every figure</span> before
            saving. Nothing has been recorded yet.
          </p>

          <ul className="space-y-1">
            {scan.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-1.5 text-xs">
                {c.status === 'OK' ? (
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-good-fg" />
                ) : (
                  <AlertTriangle
                    size={14}
                    className={`mt-0.5 shrink-0 ${
                      c.status === 'WARN' ? 'text-warn-fg' : 'text-fg-subtle'
                    }`}
                  />
                )}
                <span className={c.status === 'WARN' ? 'text-warn-fg' : 'text-fg-muted'}>
                  {c.message}
                </span>
              </li>
            ))}
          </ul>

          {scan.supplierUnmatched && scan.extracted.supplierName && (
            <p className="text-xs text-warn-fg">
              “{scan.extracted.supplierName}” is not on your supplier list. Pick the right one
              below, or add them first — a bill on the wrong supplier misstates what both are owed.
            </p>
          )}
          {scan.extracted.note && (
            <p className="text-xs text-fg-subtle">Noted: {scan.extracted.note}</p>
          )}
        </div>
      )}
    </div>
  );
}
