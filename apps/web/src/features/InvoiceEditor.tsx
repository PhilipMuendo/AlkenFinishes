import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Invoice, InvoiceType } from '@/lib/types';
import { fmtMoney, todayISO } from '@/lib/format';
import { previewInvoiceTotals } from '@/lib/invoiceMath';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';

export const INVOICE_TYPE_LABEL: Record<InvoiceType, string> = {
  MOBILISATION: 'Mobilisation',
  PROGRESS_CLAIM: 'Progress claim',
  VARIATION: 'Variation',
  FINAL_ACCOUNT: 'Final account',
  RETENTION: 'Retention release',
};

interface DraftLine {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxable: boolean;
}

export interface InvoicePayload {
  type: InvoiceType;
  title?: string;
  issueDate: string;
  dueDate: string;
  vatRatePct: number;
  retentionRatePct: number;
  notes?: string;
  lines: {
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    taxable: boolean;
  }[];
}

const UNITS = ['item', 'm2', 'm3', 'lm', 'pcs', 'days', 'sum'];

let keySeq = 0;
const blankLine = (): DraftLine => ({
  key: `l${keySeq++}`,
  description: '',
  quantity: '1',
  unit: 'item',
  unitPrice: '',
  taxable: true,
});

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Line-item editor for a draft invoice. Totals update live as the user types,
 * but they are a preview only — the server recomputes and returns the
 * authoritative figures on save.
 */
export function InvoiceEditor({
  existing,
  defaults,
  submitting,
  error,
  onSubmit,
}: {
  existing?: Invoice;
  defaults: { vatRatePct: number; retentionRatePct: number; paymentTermsDays: number };
  submitting: boolean;
  error?: React.ReactNode;
  onSubmit: (payload: InvoicePayload) => void;
}) {
  const [type, setType] = useState<InvoiceType>(existing?.type ?? 'PROGRESS_CLAIM');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [issueDate, setIssueDate] = useState(existing?.issueDate.slice(0, 10) ?? todayISO());
  const [dueDate, setDueDate] = useState(
    existing?.dueDate.slice(0, 10) ?? addDays(todayISO(), defaults.paymentTermsDays),
  );
  const [vatRatePct, setVatRatePct] = useState(String(existing?.vatRatePct ?? defaults.vatRatePct));
  const [retentionRatePct, setRetentionRatePct] = useState(
    String(existing?.retentionRatePct ?? defaults.retentionRatePct),
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [lines, setLines] = useState<DraftLine[]>(
    existing?.lines.length
      ? existing.lines.map((l) => ({
          key: l.id,
          description: l.description,
          quantity: String(l.quantity),
          unit: l.unit,
          unitPrice: String(l.unitPrice),
          taxable: l.taxable,
        }))
      : [blankLine()],
  );

  const totals = useMemo(
    () => previewInvoiceTotals(lines, Number(vatRatePct) || 0, Number(retentionRatePct) || 0),
    [lines, vatRatePct, retentionRatePct],
  );

  const patch = (key: string, changes: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...changes } : l)));

  const valid =
    lines.length > 0 &&
    lines.every((l) => l.description.trim() && Number(l.quantity) > 0 && l.unitPrice !== '');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          type,
          title: title.trim() || undefined,
          issueDate,
          dueDate,
          vatRatePct: Number(vatRatePct) || 0,
          retentionRatePct: Number(retentionRatePct) || 0,
          notes: notes.trim() || undefined,
          lines: lines.map((l) => ({
            description: l.description.trim(),
            quantity: Number(l.quantity),
            unit: l.unit,
            unitPrice: Number(l.unitPrice),
            taxable: l.taxable,
          })),
        });
      }}
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Invoice type">
          <Select value={type} onChange={(e) => setType(e.target.value as InvoiceType)}>
            {(Object.keys(INVOICE_TYPE_LABEL) as InvoiceType[]).map((t) => (
              <option key={t} value={t}>
                {INVOICE_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference (optional)">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Claim No. 3"
          />
        </Field>
        <Field label="Issue date">
          <Input
            type="date"
            value={issueDate}
            onChange={(e) => {
              setIssueDate(e.target.value);
              setDueDate(addDays(e.target.value, defaults.paymentTermsDays));
            }}
            required
          />
        </Field>
        <Field label="Due date">
          <Input
            type="date"
            value={dueDate}
            min={issueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
          />
        </Field>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-fg-muted">Lines</span>
          <span className="text-xs text-fg-subtle">Untick VAT on a line to zero-rate it</span>
        </div>

        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={l.key} className="rounded-lg border border-hairline bg-surface-muted/40 p-3">
              <div className="flex items-start gap-2">
                <Input
                  value={l.description}
                  onChange={(e) => patch(l.key, { description: e.target.value })}
                  placeholder="Description of works"
                  aria-label={`Line ${i + 1} description`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  disabled={lines.length === 1}
                  aria-label={`Remove line ${i + 1}`}
                  className="mt-0.5 shrink-0 rounded-lg p-2.5 text-fg-subtle transition-colors hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-30"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              <div className="mt-2 grid grid-cols-2 items-end gap-2 sm:grid-cols-[5rem_6rem_1fr_auto]">
                <Field label="Qty">
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) => patch(l.key, { quantity: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Unit">
                  <Select value={l.unit} onChange={(e) => patch(l.key, { unit: e.target.value })}>
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Rate (KES)">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={l.unitPrice}
                    onChange={(e) => patch(l.key, { unitPrice: e.target.value })}
                    required
                  />
                </Field>
                <div className="flex items-center gap-3 pb-2.5 sm:pb-0">
                  <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                    <input
                      type="checkbox"
                      checked={l.taxable}
                      onChange={(e) => patch(l.key, { taxable: e.target.checked })}
                      className="h-3.5 w-3.5 rounded border-hairline-strong accent-brand-600"
                    />
                    VAT
                  </label>
                  <span className="ml-auto whitespace-nowrap text-sm font-medium tabular-nums text-fg sm:ml-0 sm:min-w-[5.5rem] sm:text-right">
                    {fmtMoney(totals.lineTotals[i] ?? 0)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => setLines((ls) => [...ls, blankLine()])}
        >
          <Plus size={14} /> Add line
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="VAT rate (%)">
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            inputMode="decimal"
            value={vatRatePct}
            onChange={(e) => setVatRatePct(e.target.value)}
          />
        </Field>
        <Field label="Retention (% of subtotal)">
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            inputMode="decimal"
            value={retentionRatePct}
            onChange={(e) => setRetentionRatePct(e.target.value)}
          />
        </Field>
      </div>

      {/* Mirrors the totals block on the printed invoice, in the same order. */}
      <div className="rounded-lg border border-hairline bg-surface-muted/40 p-3">
        <dl className="space-y-1.5 text-sm">
          <Row label="Subtotal" value={totals.subtotal} />
          {Number(vatRatePct) > 0 && (
            <Row label={`VAT @ ${Number(vatRatePct)}%`} value={totals.vatAmount} />
          )}
          <Row label="Total" value={totals.grossTotal} />
          {Number(retentionRatePct) > 0 && (
            <Row
              label={`Less retention @ ${Number(retentionRatePct)}%`}
              value={-totals.retentionAmount}
            />
          )}
          <div className="flex items-baseline justify-between border-t border-hairline pt-1.5">
            <dt className="font-medium text-fg">Amount payable</dt>
            <dd className="text-base font-semibold tabular-nums text-fg">
              {fmtMoney(totals.netPayable)}
            </dd>
          </div>
        </dl>
        {Number(retentionRatePct) > 0 && (
          <p className="mt-2 text-xs text-fg-subtle">
            Retention is withheld against the subtotal before VAT, and billed later as a retention
            release invoice.
          </p>
        )}
      </div>

      <Field label="Notes (optional)">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Payment terms, scope notes, or anything the client should see"
        />
      </Field>

      {error}

      <Button type="submit" size="lg" className="w-full" disabled={submitting || !valid}>
        {existing ? 'Save changes' : 'Save draft'}
      </Button>
    </form>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="tabular-nums text-fg">{fmtMoney(value)}</dd>
    </div>
  );
}
