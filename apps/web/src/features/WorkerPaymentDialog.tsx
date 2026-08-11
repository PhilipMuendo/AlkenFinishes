import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { PaymentMethodValue, Worker, WorkerPaymentSuggestion } from '@/lib/types';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { toast } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Paying a casual/contracted worker, in part or in full.
 *
 * Mirrors SupplierPaymentDialog: the figure that matters is what SETTLES the
 * balance, which is cash sent plus any tax withheld from it. Withholding is
 * shown adding up as it is typed, for the same reason — the mistake this
 * screen exists to prevent is treating withheld tax as still owed and paying
 * it to the worker a second time.
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

export function WorkerPaymentDialog({ worker, onDone }: { worker: Worker; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: suggestion } = useQuery({
    queryKey: ['workers', worker.id, 'payment-suggestion'],
    queryFn: () => api<WorkerPaymentSuggestion>(`/workers/${worker.id}/payment-suggestion`),
  });

  const [amount, setAmount] = useState('');
  const [wht, setWht] = useState('0');
  const [method, setMethod] = useState<PaymentMethodValue>('MPESA');
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [referenceNo, setReferenceNo] = useState('');
  const [whtCertNo, setWhtCertNo] = useState('');
  const [notes, setNotes] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [overpayAccepted, setOverpayAccepted] = useState(false);

  // Default to settling the balance in full, with withholding already worked
  // out at the configured rate. Typing over it is the normal case for a part
  // payment; getting the tax right by default is the point.
  useEffect(() => {
    if (!suggestion) return;
    setAmount(String(suggestion.suggested.amount));
    setWht(String(suggestion.suggested.whtAmount));
  }, [suggestion]);

  const position = suggestion?.position;
  const settles = round2(num(amount) + num(wht));
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
      if (referenceNo.trim()) fd.set('referenceNo', referenceNo.trim());
      if (whtCertNo.trim()) fd.set('whtCertNo', whtCertNo.trim());
      if (notes.trim()) fd.set('notes', notes.trim());
      if (isOverpayment && overpayAccepted) fd.set('allowOverpayment', 'true');
      if (proof) fd.set('proof', proof);
      return api(`/workers/${worker.id}/payments`, { formData: fd });
    },
    onSuccess: () => {
      toast.success(
        num(wht) > 0
          ? `${fmtMoney(num(amount))} paid to ${worker.name} plus ${fmtMoney(num(wht))} withheld for KRA — ${fmtMoney(settles)} off the balance.`
          : `${fmtMoney(num(amount))} paid to ${worker.name}.` +
            (remainingAfter > 0 ? ` ${fmtMoney(remainingAfter)} still owed.` : ' Balance cleared.'),
      );
      void qc.invalidateQueries({ queryKey: ['workers'] });
      void qc.invalidateQueries({ queryKey: ['workers', worker.id, 'payment-suggestion'] });
      onDone();
    },
    onError: (e) => toast.error(errText(e, 'The payment was not recorded.')),
  });

  const remove = useMutation({
    mutationFn: (paymentId: string) =>
      api(`/workers/${worker.id}/payments/${paymentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Payment removed. The balance is owed again in full.');
      void qc.invalidateQueries({ queryKey: ['workers'] });
      void qc.invalidateQueries({ queryKey: ['workers', worker.id, 'payment-suggestion'] });
    },
    onError: (e) => toast.error(errText(e, 'The payment was not removed.')),
  });

  if (!position) return <Skeleton className="h-48 w-full rounded-xl" />;

  const blocked =
    settles <= 0 || (isOverpayment && !overpayAccepted) || pay.isPending || position.settled;

  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium text-fg">{worker.name}</p>
        <p className="text-xs text-fg-subtle">{worker.trade}</p>
      </div>

      <div className="rounded-lg border border-hairline bg-surface-muted p-3 text-sm">
        <Row label="Accrued from attendance" value={position.accrued} />
        <Row label="Settled so far" value={position.paid} muted />
        <div className="mt-2 border-t border-hairline pt-2">
          <Row label="Still owed" value={position.outstanding} strong />
        </div>
      </div>

      {position.settled ? (
        <Notice tone="good">This worker is fully settled. Nothing further is owed.</Notice>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cash paid (KES)">
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
              Withheld tax settles this balance just as cash does — the worker is paid in full
              without it. Leave at zero if you did not withhold.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
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
              <Field label="Certificate no.">
                <Input value={whtCertNo} onChange={(e) => setWhtCertNo(e.target.value)} />
              </Field>
            </div>
            {suggestion && suggestion.tax.withholdingAgent && (
              <p className="mt-1.5 text-xs text-fg-subtle">
                Suggested at {suggestion.tax.defaultWhtRatePct}% of the {fmtMoney(position.outstanding)}{' '}
                owed.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-hairline bg-surface-muted p-3 text-sm">
            <Row label="Cash to worker" value={num(amount)} muted />
            <Row label="Tax to KRA" value={num(wht)} muted />
            <div className="mt-1 border-t border-hairline pt-1">
              <Row label="Settles" value={settles} strong />
            </div>
            <div className="mt-2 flex justify-between border-t border-hairline pt-2">
              <span className="font-medium text-fg">
                {remainingAfter > 0 ? 'Still owed after this' : 'Balance cleared'}
              </span>
              <span className="font-semibold tabular-nums text-fg">
                {fmtMoney(Math.max(0, remainingAfter))}
              </span>
            </div>
          </div>

          <Field label="Proof of payment" hint="M-Pesa message, bank slip">
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
            <Notice as="label" tone="warn" icon={AlertTriangle}>
              <span>
                <span className="font-medium text-fg">
                  This is {fmtMoney(round2(settles - outstanding))} more than is owed
                </span>
                <span className="mt-1 block text-fg-muted">
                  Either a figure is mistyped, or an advance is being made against future hours.
                </span>
                <span className="mt-2 flex items-center gap-2 font-medium text-fg">
                  <input
                    type="checkbox"
                    checked={overpayAccepted}
                    onChange={(e) => setOverpayAccepted(e.target.checked)}
                    className="size-4 accent-amber-600"
                  />
                  This is right
                </span>
              </span>
            </Notice>
          )}

          {pay.isError && (
            <p className="text-sm text-danger-fg">
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

      {(suggestion?.payments.length ?? 0) > 0 && (
        <div className="border-t border-hairline pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
            Payments so far
          </p>
          <div className="space-y-2">
            {suggestion!.payments.map((p) => (
              <div
                key={p.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-hairline p-2.5 text-sm"
              >
                <div>
                  <p className="font-medium tabular-nums text-fg">
                    {fmtMoney(p.amount)}
                    {p.whtAmount > 0 && (
                      <span className="ml-1.5 font-normal text-fg-muted">
                        + {fmtMoney(p.whtAmount)} to KRA
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
                      className="text-fg-subtle hover:text-danger-fg"
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
            <p className="mt-2 text-sm text-danger-fg">
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
