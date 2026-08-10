import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileText } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { ClaimPosition, ClaimSchedule } from '@/lib/types';
import { fmtMoney, todayISO } from '@/lib/format';
import { previewInvoiceTotals } from '@/lib/invoiceMath';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { Notice } from '@/components/ui/notice';
import { toast } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Raising a progress claim.
 *
 * The user states one thing per item of the priced schedule: how complete it
 * is TO DATE. Everything else — what that is worth, what earlier claims
 * already took, what this claim therefore bills — is arithmetic, and it is
 * shown as it is typed so the figure is checked before it is sent rather than
 * after the client queries it.
 *
 * The totals here are a preview. The server recomputes them on save, and its
 * numbers are the ones that reach the invoice.
 */

/** Half-up to whole cents, matching the server. */
const cents = (v: number) => Math.round((v + Number.EPSILON) * 100);
const pctOfCents = (baseCents: number, pct: number) =>
  Math.round((baseCents * pct) / 100 + Number.EPSILON);

export interface ClaimBuilderDefaults {
  vatRatePct: number;
  retentionRatePct: number;
  paymentTermsDays: number;
}

export function ClaimBuilder({
  projectId,
  defaults,
  onDone,
}: {
  projectId: string;
  defaults: ClaimBuilderDefaults;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', 'claim-schedule', projectId],
    queryFn: () => api<ClaimSchedule>(`/projects/${projectId}/invoices/claim-schedule`),
  });

  const [pcts, setPcts] = useState<Record<string, string>>({});
  const [issueDate, setIssueDate] = useState(todayISO());
  const [dueInDays, setDueInDays] = useState(String(defaults.paymentTermsDays));
  const [retentionRatePct, setRetentionRatePct] = useState(String(defaults.retentionRatePct));
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [creditsAccepted, setCreditsAccepted] = useState(false);

  const rows = useMemo(() => {
    // An untouched row sits at whatever was already claimed, so it bills
    // nothing. The user raises the figures they have measured this month and
    // leaves the rest alone — the claim is what changed, not a full re-entry.
    const pctFor = (p: ClaimPosition) => pcts[p.line.id] ?? String(p.previouslyClaimedPct);
    return (data?.positions ?? []).map((position) => {
      const input = pctFor(position);
      const parsed = parseFloat(input);
      const pct = Number.isFinite(parsed) ? parsed : 0;
      const cumulative = pctOfCents(cents(position.line.lineTotal), pct) / 100;
      return {
        position,
        input,
        pct,
        valid: Number.isFinite(parsed) && pct >= 0 && pct <= 100,
        cumulative,
        thisClaim: cumulative - position.previouslyClaimed,
      };
    });
  }, [data, pcts]);

  const claimed = rows.filter((r) => r.valid && cents(r.thisClaim) !== 0);
  const reversals = claimed.filter((r) => r.thisClaim < 0);
  const invalid = rows.filter((r) => !r.valid);

  const totals = previewInvoiceTotals(
    claimed.map((r) => ({
      quantity: r.position.line.quantity,
      unitPrice: r.position.line.unitPrice,
      taxable: r.position.line.taxable,
      lineTotal: r.thisClaim,
    })),
    defaults.vatRatePct,
    parseFloat(retentionRatePct) || 0,
  );

  const raise = useMutation({
    mutationFn: () =>
      api<{ invoiceNo: string | null }>(`/projects/${projectId}/invoices/claim`, {
        body: {
          issueDate,
          dueInDays: parseInt(dueInDays, 10) || 0,
          retentionRatePct: parseFloat(retentionRatePct) || 0,
          allowReversals: reversals.length > 0 && creditsAccepted,
          ...(title.trim() && { title: title.trim() }),
          ...(notes.trim() && { notes: notes.trim() }),
          items: claimed.map((r) => ({ sourceLineId: r.position.line.id, cumulativePct: r.pct })),
        },
      }),
    onSuccess: (inv) => {
      toast.success(
        `${inv.invoiceNo ?? 'Claim'} raised for ${fmtMoney(totals.netPayable)} net of retention.`,
      );
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['analytics', 'company'] });
      onDone();
    },
    onError: (e) => toast.error(errText(e, 'The claim was not raised.')),
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;

  if (!data?.hasSchedule) {
    return (
      <Empty icon={FileText}>
        <p className="font-medium text-fg">Nothing to claim against</p>
        <p className="mt-1 max-w-sm text-fg-muted">
          A progress claim is measured against the priced schedule the client agreed to. Link this
          project to a contract with an accepted quotation, then come back — the items will be here
          with their contract values already filled in.
        </p>
      </Empty>
    );
  }

  const blocked =
    invalid.length > 0 ||
    claimed.length === 0 ||
    (reversals.length > 0 && !creditsAccepted) ||
    raise.isPending;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Contract value" value={data.contractValue} />
        <Stat
          label="Claimed to date"
          value={data.claimedToDate}
          hint={
            data.contractValue > 0
              ? `${Math.round((data.claimedToDate / data.contractValue) * 100)}% of the contract`
              : undefined
          }
        />
        <Stat label="Left to claim" value={data.remainingToClaim} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-hairline">
        <Table>
          <thead>
            <tr>
              <Th>Schedule item</Th>
              <Th className="text-right">Contract value</Th>
              <Th className="text-right">Claimed to date</Th>
              <Th className="text-right">% complete now</Th>
              <Th className="text-right">This claim</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.position.line.id}>
                <Td>
                  <p className="font-medium text-fg">{r.position.line.description}</p>
                  <p className="text-xs text-fg-subtle">
                    {r.position.line.quantity} {r.position.line.unit} @{' '}
                    {fmtMoney(r.position.line.unitPrice)}
                  </p>
                </Td>
                <Td className="text-right tabular-nums">{fmtMoney(r.position.line.lineTotal)}</Td>
                <Td className="text-right tabular-nums">
                  {fmtMoney(r.position.previouslyClaimed)}
                  <p className="text-xs text-fg-subtle">{r.position.previouslyClaimedPct}%</p>
                </Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      inputMode="decimal"
                      value={r.input}
                      onChange={(e) =>
                        setPcts((p) => ({ ...p, [r.position.line.id]: e.target.value }))
                      }
                      className={`h-9 w-24 text-right tabular-nums ${
                        r.valid ? '' : 'border-red-500 focus:border-red-500 focus:ring-red-500/30'
                      }`}
                      aria-label={`Percent complete for ${r.position.line.description}`}
                    />
                    <button
                      type="button"
                      onClick={() => setPcts((p) => ({ ...p, [r.position.line.id]: '100' }))}
                      className="text-xs text-brand-600 hover:underline"
                      title="Claim this item in full"
                    >
                      All
                    </button>
                  </div>
                </Td>
                <Td
                  className={`text-right font-medium tabular-nums ${
                    r.thisClaim < 0 ? 'text-danger-fg' : 'text-fg'
                  }`}
                >
                  {r.valid ? (
                    fmtMoney(r.thisClaim)
                  ) : (
                    <span className="text-xs text-danger-fg">0–100 only</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Issue date">
          <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </Field>
        <Field label="Payment terms (days)">
          <Input
            type="number"
            min={0}
            value={dueInDays}
            onChange={(e) => setDueInDays(e.target.value)}
          />
        </Field>
        <Field label="Retention %">
          <Input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={retentionRatePct}
            onChange={(e) => setRetentionRatePct(e.target.value)}
          />
        </Field>
        <Field label="Title" hint="Optional — e.g. Claim No. 3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Progress claim"
          />
        </Field>
      </div>

      <Field label="Notes on the invoice" hint="Optional. Printed on the claim.">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-[70px]"
        />
      </Field>

      <div className="rounded-lg border border-hairline bg-surface-muted p-3 text-sm">
        <TotalRow
          label={`This claim (${claimed.length} item${claimed.length === 1 ? '' : 's'})`}
          value={totals.subtotal}
        />
        <TotalRow label={`VAT at ${defaults.vatRatePct}%`} value={totals.vatAmount} />
        <TotalRow label="Gross" value={totals.grossTotal} />
        {totals.retentionAmount !== 0 && (
          <TotalRow label={`Retention at ${retentionRatePct}%`} value={-totals.retentionAmount} />
        )}
        <div className="mt-2 border-t border-hairline pt-2">
          <TotalRow label="Net payable" value={totals.netPayable} strong />
        </div>
      </div>

      {reversals.length > 0 && (
        <Notice as="label" tone="warn" icon={AlertTriangle}>
          <span>
            <span className="font-medium text-fg">
              {reversals.length} item{reversals.length === 1 ? '' : 's'} went backwards
            </span>
            <span className="mt-1 block text-fg-muted">
              A percentage below what was already claimed bills a credit, not a charge. That is the
              right answer when the last claim over-stated the work — but it has to be deliberate.
            </span>
            <span className="mt-2 flex items-center gap-2 font-medium text-fg">
              <input
                type="checkbox"
                checked={creditsAccepted}
                onChange={(e) => setCreditsAccepted(e.target.checked)}
                className="size-4 accent-amber-600"
              />
              Yes, credit the client for the difference
            </span>
          </span>
        </Notice>
      )}

      {raise.isError && (
        <p className="text-sm text-danger-fg">
          {raise.error instanceof ApiRequestError
            ? raise.error.message
            : 'Failed to raise this claim'}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" className="flex-1" disabled={blocked} onClick={() => raise.mutate()}>
          {raise.isPending ? 'Raising…' : 'Raise draft claim'}
        </Button>
      </div>
      <p className="text-center text-xs text-fg-subtle">
        This creates a draft. Nothing is numbered or sent until you issue it.
      </p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-muted px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{fmtMoney(value)}</p>
      {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className={`min-w-0 ${strong ? 'font-medium text-fg' : 'text-fg-muted'}`}>{label}</span>
      <span
        className={`shrink-0 whitespace-nowrap tabular-nums ${strong ? 'font-semibold text-fg' : 'text-fg'}`}
      >
        {fmtMoney(value)}
      </span>
    </div>
  );
}
