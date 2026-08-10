import { useMemo, useState } from 'react';
import type { Client, Lead, Quotation } from '@/lib/types';
import { addDays, fmtMoney, todayISO } from '@/lib/format';
import { previewInvoiceTotals } from '@/lib/invoiceMath';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Field, Input, Textarea } from '@/components/ui/input';
import {
  LineItemsEditor,
  linesFrom,
  linesPayload,
  linesValid,
  type DraftLine,
} from './LineItemsEditor';

export interface QuotationPayload {
  clientId: string;
  leadId?: string;
  title: string;
  issueDate: string;
  validUntil: string;
  vatRatePct: number;
  termsText?: string;
  notes?: string;
  lines: ReturnType<typeof linesPayload>;
}

/**
 * Line-item editor for a draft quotation.
 *
 * Totals are a live preview computed by the same rules as the server, but the
 * server recomputes and returns the authoritative figures on save. Retention is
 * absent by design — it is a contract term, not something a client is quoted.
 */
export function QuotationEditor({
  existing,
  clients,
  leads,
  defaults,
  submitting,
  error,
  onSubmit,
}: {
  existing?: Quotation;
  clients: Client[];
  leads: Lead[];
  defaults: { vatRatePct: number; validityDays: number; termsText: string };
  submitting: boolean;
  error?: React.ReactNode;
  onSubmit: (payload: QuotationPayload) => void;
}) {
  const [clientId, setClientId] = useState(existing?.clientId ?? '');
  const [leadId, setLeadId] = useState(existing?.leadId ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [issueDate, setIssueDate] = useState(existing?.issueDate.slice(0, 10) ?? todayISO());
  const [validUntil, setValidUntil] = useState(
    existing?.validUntil.slice(0, 10) ?? addDays(todayISO(), defaults.validityDays),
  );
  const [vatRatePct, setVatRatePct] = useState(String(existing?.vatRatePct ?? defaults.vatRatePct));
  const [termsText, setTermsText] = useState(existing?.termsText ?? defaults.termsText);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [lines, setLines] = useState<DraftLine[]>(linesFrom(existing?.lines));

  const totals = useMemo(
    () => previewInvoiceTotals(lines, Number(vatRatePct) || 0, 0),
    [lines, vatRatePct],
  );

  // Picking a lead is the shortcut: it already knows the client and the job.
  const openLeads = leads.filter((l) => l.stage !== 'LOST');
  const applyLead = (id: string) => {
    setLeadId(id);
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    setClientId(lead.clientId);
    if (!title.trim()) setTitle(lead.title);
  };

  const valid = !!clientId && !!title.trim() && linesValid(lines);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          clientId,
          leadId: leadId || undefined,
          title: title.trim(),
          issueDate,
          validUntil,
          vatRatePct: Number(vatRatePct) || 0,
          termsText: termsText.trim() || undefined,
          notes: notes.trim() || undefined,
          lines: linesPayload(lines),
        });
      }}
      className="space-y-4"
    >
      <Field label="Against a lead (optional)">
        <Combobox
          value={leadId}
          onChange={applyLead}
          placeholder="Not from a lead"
          aria-label="Lead"
          options={openLeads.map((l) => ({ value: l.id, label: `${l.title} — ${l.client.name}` }))}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client">
          <Combobox
            value={clientId}
            onChange={setClientId}
            placeholder="Search clients…"
            aria-label="Client"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        <Field label="Job title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Riverside Tower — interior finishes"
            required
          />
        </Field>
        <Field label="Issue date">
          <Input
            type="date"
            value={issueDate}
            onChange={(e) => {
              setIssueDate(e.target.value);
              setValidUntil(addDays(e.target.value, defaults.validityDays));
            }}
            required
          />
        </Field>
        <Field label="Valid until">
          <Input
            type="date"
            value={validUntil}
            min={issueDate}
            onChange={(e) => setValidUntil(e.target.value)}
            required
          />
        </Field>
      </div>

      <LineItemsEditor
        lines={lines}
        onChange={setLines}
        lineTotals={totals.lineTotals}
        descriptionPlaceholder="Description of works"
      />

      <Field label="VAT rate (%)">
        <Input
          type="number"
          min="0"
          max="100"
          step="0.01"
          inputMode="decimal"
          value={vatRatePct}
          onChange={(e) => setVatRatePct(e.target.value)}
          className="sm:max-w-[10rem]"
        />
      </Field>

      {/* Mirrors the totals block on the printed quotation, in the same order. */}
      <div className="rounded-lg border border-hairline bg-surface-muted/40 p-3">
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-fg-muted">Subtotal</dt>
            <dd className="tabular-nums text-fg">{fmtMoney(totals.subtotal)}</dd>
          </div>
          {Number(vatRatePct) > 0 && (
            <div className="flex items-baseline justify-between">
              <dt className="text-fg-muted">VAT @ {Number(vatRatePct)}%</dt>
              <dd className="tabular-nums text-fg">{fmtMoney(totals.vatAmount)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between border-t border-hairline pt-1.5">
            <dt className="font-medium text-fg">Quotation total</dt>
            <dd className="text-base font-semibold tabular-nums text-fg">
              {fmtMoney(totals.grossTotal)}
            </dd>
          </div>
        </dl>
      </div>

      <Field label="Terms">
        <Textarea
          value={termsText}
          onChange={(e) => setTermsText(e.target.value)}
          rows={4}
          placeholder="One condition per line"
        />
      </Field>
      <p className="-mt-2 text-xs text-fg-subtle">
        Each line prints as a separate bullet on the quotation.
      </p>

      <Field label="Notes (optional)">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything else the client should see"
        />
      </Field>

      {error}

      <Button type="submit" size="lg" className="w-full" disabled={submitting || !valid}>
        {existing ? 'Save changes' : 'Save draft'}
      </Button>
    </form>
  );
}
