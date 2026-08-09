import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import type { Expense, PaymentMethodValue, PaymentSuggestion } from '@/lib/types';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

/**
 * Paying a supplier, in part or in full.
 *
 * The figure that matters is what SETTLES the bill, which is the cash sent
 * plus any tax withheld from it. Those are shown adding up as they are typed,
 * because the mistake this screen exists to prevent is treating a withheld
 * 15,000 as still owed and paying it to the supplier a second time.
 */

const METHODS: { value: PaymentMethodValue; label: string }[] = [
  { value: 'MPESA', label: 'M-Pesa' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CASH', label: 'Cash' },
  { value: 'OTHER', label: 'Other' },
];

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function SupplierPaymentDialog({
  projectId,
  expense,
  onDone,
}: {
  projectId: string;
  expense: Expense;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const { data: suggestion } = useQuery({
    queryKey: ['expenses', projectId, expense.id, 'payment-suggestion'],
    queryFn: () =>
      api<PaymentSuggestion>(
        `/projects/${projectId}/expenses/${expense.id}/payment-suggestion`,
      ),
  });

  const [amount, setAmount] = useState('');
  const [wht, setWht] = useState('0');
  const [whtVat, setWhtVat] = useState('0');
  const [method, setMethod] = useState<PaymentMethodValue>('MPESA');
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [referenceNo, setReferenceNo] = useState('');
  const [whtCertNo, setWhtCertNo] = useState('');
  const [notes, setNotes] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [overpayAccepted, setOverpayAccepted] = useState(false);

  // Default to settling the bill in full, with withholding already worked out
  // at the configured rate. Typing over it is the normal case for a part
  // payment; getting the tax right by default is the point.
  useEffect(() => {
    if (!suggestion) return;
    setAmount(String(suggestion.suggested.amount));
    setWht(String(suggestion.suggested.whtAmount));
    setWhtVat(String(suggestion.suggested.whtVatAmount));
  }, [suggestion]);

  const position = suggestion?.position;
  const withheld = round2(num(wht) + num(whtVat));
  const settles = round2(num(amount) + withheld);
  const outstanding = position?.outstanding ?? 0;
  const remainingAfter = round2(outstanding - settles);
  const isOverpayment = settles > outstanding;

  const pay = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.set('amount', String(num(amount)));
      fd.set('method', method);
      fd.set('paymentDate', paymentDate);
      fd.set('whtAmount', String(num(wht)));
      fd.set('whtVatAmount', String(num(whtVat)));
      if (referenceNo.trim()) fd.set('referenceNo', referenceNo.trim());
      if (whtCertNo.trim()) fd.set('whtCertNo', whtCertNo.trim());
      if (notes.trim()) fd.set('notes', notes.trim());
      if (isOverpayment && overpayAccepted) fd.set('allowOverpayment', 'true');
      if (proof) fd.set('proof', proof);
      return api(`/projects/${projectId}/expenses/${expense.id}/payments`, { formData: fd });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      void qc.invalidateQueries({ queryKey: ['analytics', 'company'] });
      onDone();
    },
  });

  const remove = useMutation({
    mutationFn: (paymentId: string) =>
      api(`/projects/${projectId}/expenses/${expense.id}/payments/${paymentId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      void qc.invalidateQueries({
        queryKey: ['expenses', projectId, expense.id, 'payment-suggestion'],
      });
    },
  });

  if (!position) return <p className="py-8 text-center text-sm text-fg-muted">Loading…</p>;

  const blocked =
    settles <= 0 || (isOverpayment && !overpayAccepted) || pay.isPending || position.settled;

  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium text-fg">{expense.description}</p>
        <p className="text-xs text-fg-subtle">
          {expense.supplier?.name}
          {expense.supplierInvoiceNo && ` · Invoice ${expense.supplierInvoiceNo}`}
          {expense.dueDate && ` · due ${fmtDate(expense.dueDate)}`}
        </p>
      </div>

      <div className="rounded-lg border border-hairline bg-surface-muted p-3 text-sm">
        <Row label="Bill total" value={position.amount} />
        {position.vatAmount > 0 && (
          <Row
            label={`of which VAT${position.reclaimableVat > 0 ? ' (reclaimable)' : ' (no tax invoice)'}`}
            value={position.vatAmount}
            muted
          />
        )}
        <Row label="Settled so far" value={position.paid} muted />
        <div className="mt-2 border-t border-hairline pt-2">
          <Row label="Still owed" value={position.outstanding} strong />
        </div>
        {position.overdue && (
          <p className="mt-1 text-xs text-red-600">{position.daysOverdue} days past due</p>
        )}
      </div>

      {position.settled ? (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40">
          This bill is fully settled. Nothing further is owed.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cash paid to supplier (KES)">
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Paid on">
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </Field>
            <Field label="Method">
              <Select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethodValue)}
              >
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference" hint="M-Pesa code, EFT ref, cheque number">
              <Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
            </Field>
          </div>

          <div className="rounded-lg border border-hairline p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
              Tax withheld and paid to KRA
            </p>
            <p className="mb-2 mt-1 text-xs text-fg-muted">
              Withheld tax settles this bill just as cash does — the supplier is paid in full
              without it. Leave at zero if you did not withhold.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Withholding tax">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={wht}
                  onChange={(e) => setWht(e.target.value)}
                />
              </Field>
              <Field label="Withholding VAT">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={whtVat}
                  onChange={(e) => setWhtVat(e.target.value)}
                />
              </Field>
              <Field label="Certificate no.">
                <Input value={whtCertNo} onChange={(e) => setWhtCertNo(e.target.value)} />
              </Field>
            </div>
            {suggestion && suggestion.tax.withholdingAgent && (
              <p className="mt-1.5 text-xs text-fg-subtle">
                Suggested at {suggestion.tax.defaultWhtRatePct}% of the {fmtMoney(suggestion.outstandingNet)}{' '}
                ex-VAT balance. Withholding is never struck on the VAT-inclusive figure.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-hairline bg-surface-muted p-3 text-sm">
            <Row label="Cash to supplier" value={num(amount)} muted />
            <Row label="Tax to KRA" value={withheld} muted />
            <div className="mt-1 border-t border-hairline pt-1">
              <Row label="Settles" value={settles} strong />
            </div>
            <div className="mt-2 flex justify-between border-t border-hairline pt-2">
              <span className="font-medium text-fg">
                {remainingAfter > 0 ? 'Still owed after this' : 'Bill cleared'}
              </span>
              <span className="font-semibold tabular-nums text-fg">
                {fmtMoney(Math.max(0, remainingAfter))}
              </span>
            </div>
          </div>

          <Field label="Proof of payment" hint="Bank slip, M-Pesa message, till receipt">
            <Input
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => setProof(e.target.files?.[0] ?? null)}
            />
          </Field>

          <Field label="Notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[60px]"
            />
          </Field>

          {isOverpayment && (
            <label className="flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
              <span>
                <span className="font-medium text-fg">
                  This is {fmtMoney(round2(settles - outstanding))} more than is owed
                </span>
                <span className="mt-1 block text-fg-muted">
                  Either a figure is mistyped, or the supplier now owes the difference back.
                </span>
                <span className="mt-2 flex items-center gap-2 font-medium text-fg">
                  <input
                    type="checkbox"
                    checked={overpayAccepted}
                    onChange={(e) => setOverpayAccepted(e.target.checked)}
                    className="size-4 accent-amber-600"
                  />
                  The bank statement says this is right
                </span>
              </span>
            </label>
          )}

          {pay.isError && (
            <p className="text-sm text-red-600">
              {pay.error instanceof ApiRequestError
                ? pay.error.message
                : 'Failed to record this payment'}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onDone}>
              Cancel
            </Button>
            <Button type="button" className="flex-1" disabled={blocked} onClick={() => pay.mutate()}>
              {pay.isPending ? 'Recording…' : 'Record payment'}
            </Button>
          </div>
        </>
      )}

      {expense.payments.length > 0 && (
        <div className="border-t border-hairline pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
            Payments so far
          </p>
          <div className="space-y-2">
            {expense.payments.map((p) => (
              <div
                key={p.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-hairline p-2.5 text-sm"
              >
                <div>
                  <p className="font-medium tabular-nums text-fg">
                    {fmtMoney(p.amount)}
                    {p.whtAmount + p.whtVatAmount > 0 && (
                      <span className="ml-1.5 font-normal text-fg-muted">
                        + {fmtMoney(p.whtAmount + p.whtVatAmount)} to KRA
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {fmtDate(p.paymentDate)} · {METHODS.find((m) => m.value === p.method)?.label}
                    {p.referenceNo && ` · ${p.referenceNo}`} · {p.paidBy.name}
                  </p>
                  {p.whtRemittedAt && (
                    <Badge tone="green" className="mt-1">
                      Tax remitted
                    </Badge>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {p.proofUrl && (
                    <a
                      href={p.proofUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-brand-600 hover:underline"
                    >
                      Proof
                    </a>
                  )}
                  {!p.whtRemittedAt && (
                    <button
                      type="button"
                      onClick={() => remove.mutate(p.id)}
                      disabled={remove.isPending}
                      className="text-fg-subtle hover:text-red-600"
                      title="Remove this payment"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {remove.isError && (
            <p className="mt-2 text-sm text-red-600">
              {remove.error instanceof ApiRequestError
                ? remove.error.message
                : 'Failed to remove that payment'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: number;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span
        className={`min-w-0 ${strong ? 'font-medium text-fg' : muted ? 'text-fg-muted' : 'text-fg'}`}
      >
        {label}
      </span>
      <span
        className={`shrink-0 whitespace-nowrap tabular-nums ${strong ? 'font-semibold text-fg' : 'text-fg'}`}
      >
        {fmtMoney(value)}
      </span>
    </div>
  );
}
