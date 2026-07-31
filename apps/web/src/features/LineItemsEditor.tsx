import { Plus, Trash2 } from 'lucide-react';
import { fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';

/**
 * The priced-lines grid shared by the invoice and quotation editors.
 *
 * Both documents are the same thing at this level — a description, a quantity
 * at a rate, and whether VAT applies — and the fiddly parts (per-line running
 * totals, the zero-rate tick, removing the last line) are worth having in one
 * place rather than two that drift.
 */

export interface DraftLine {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxable: boolean;
}

export const UNITS = ['item', 'm2', 'm3', 'lm', 'pcs', 'days', 'sum'];

let keySeq = 0;
export const blankLine = (): DraftLine => ({
  key: `l${keySeq++}`,
  description: '',
  quantity: '1',
  unit: 'item',
  unitPrice: '',
  taxable: true,
});

export const linesFrom = (
  existing: { id: string; description: string; quantity: number; unit: string; unitPrice: number; taxable: boolean }[] | undefined,
): DraftLine[] =>
  existing?.length
    ? existing.map((l) => ({
        key: l.id,
        description: l.description,
        quantity: String(l.quantity),
        unit: l.unit,
        unitPrice: String(l.unitPrice),
        taxable: l.taxable,
      }))
    : [blankLine()];

export const linesValid = (lines: DraftLine[]) =>
  lines.length > 0 &&
  lines.every((l) => l.description.trim() && Number(l.quantity) > 0 && l.unitPrice !== '');

export const linesPayload = (lines: DraftLine[]) =>
  lines.map((l) => ({
    description: l.description.trim(),
    quantity: Number(l.quantity),
    unit: l.unit,
    unitPrice: Number(l.unitPrice),
    taxable: l.taxable,
  }));

export function LineItemsEditor({
  lines,
  onChange,
  lineTotals,
  descriptionPlaceholder = 'Description of works',
}: {
  lines: DraftLine[];
  onChange: (next: DraftLine[]) => void;
  /** Live per-line totals, parallel to `lines`. Preview only. */
  lineTotals: number[];
  descriptionPlaceholder?: string;
}) {
  const patch = (key: string, changes: Partial<DraftLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...changes } : l)));

  return (
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
                placeholder={descriptionPlaceholder}
                aria-label={`Line ${i + 1} description`}
                required
              />
              <button
                type="button"
                onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
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
                  {fmtMoney(lineTotals[i] ?? 0)}
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
        onClick={() => onChange([...lines, blankLine()])}
      >
        <Plus size={14} /> Add line
      </Button>
    </div>
  );
}
