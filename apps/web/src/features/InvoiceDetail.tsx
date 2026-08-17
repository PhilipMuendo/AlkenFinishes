import { useQuery } from '@tanstack/react-query';
import { Download, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { Invoice } from '@/lib/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Table, Td, Th } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { INVOICE_TYPE_LABEL } from './InvoiceEditor';
import { InvoiceStatusBadge } from './InvoicesPanel';

/** Read-only view of an issued invoice, laid out to echo the printed document. */
export function InvoiceDetail({ projectId, invoiceId }: { projectId: string; invoiceId: string }) {
  const { data: inv, isLoading } = useQuery({
    queryKey: queryKeys.invoices.detail(invoiceId),
    queryFn: () => api<Invoice>(`/projects/${projectId}/invoices/${invoiceId}`),
  });

  if (isLoading || !inv) return <Skeleton className="h-64 w-full rounded-xl" />;

  const payments = inv.payments ?? [];
  const livePayments = payments.filter((p) => !p.voidedAt);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-fg">{inv.invoiceNo ?? 'Draft'}</h3>
            <InvoiceStatusBadge invoice={inv} />
          </div>
          <p className="mt-0.5 text-sm text-fg-muted">
            {INVOICE_TYPE_LABEL[inv.type]}
            {inv.title ? ` — ${inv.title}` : ''}
          </p>
        </div>
        {inv.pdfUrl && (
          <a href={inv.pdfUrl} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              <Download size={14} /> Download PDF
            </Button>
          </a>
        )}
      </div>

      {inv.status === 'VOID' && inv.voidReason && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          Voided {inv.voidedAt ? `on ${fmtDate(inv.voidedAt)}` : ''} — {inv.voidReason}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Detail label="Bill to">
          <p className="font-medium text-fg">{inv.clientName}</p>
          {inv.clientAddress && <p className="text-fg-muted">{inv.clientAddress}</p>}
          {inv.clientKraPin && <p className="text-fg-muted">KRA PIN: {inv.clientKraPin}</p>}
        </Detail>
        <Detail label="Dates">
          <p className="text-fg">Issued {fmtDate(inv.issueDate)}</p>
          <p className={inv.overdue ? 'text-red-600' : 'text-fg'}>
            Due {fmtDate(inv.dueDate)}
            {inv.overdue && ` · ${inv.daysOverdue} days late`}
          </p>
        </Detail>
      </div>

      <div className="overflow-hidden rounded-xl border border-hairline">
        <Table>
          <thead>
            <tr>
              <Th>Description</Th>
              <Th className="text-right">Qty</Th>
              <Th>Unit</Th>
              <Th className="text-right">Rate</Th>
              <Th className="text-right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <Td>
                  {l.description}
                  {!l.taxable && <span className="ml-1 text-xs text-fg-subtle">(zero-rated)</span>}
                </Td>
                <Td className="text-right nums">{Number(l.quantity)}</Td>
                <Td className="text-fg-muted">{l.unit}</Td>
                <Td className="text-right nums">{fmtMoney(l.unitPrice)}</Td>
                <Td className="text-right nums">{fmtMoney(l.lineTotal)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      <div className="flex justify-end">
        <dl className="w-full space-y-1.5 text-sm sm:w-72">
          <TotalRow label="Subtotal" value={inv.subtotal} />
          {inv.vatRatePct > 0 && <TotalRow label={`VAT @ ${inv.vatRatePct}%`} value={inv.vatAmount} />}
          <TotalRow label="Total" value={inv.grossTotal} />
          {inv.retentionRatePct > 0 && (
            <TotalRow
              label={`Less retention @ ${inv.retentionRatePct}%`}
              value={-inv.retentionAmount}
            />
          )}
          <div className="flex items-baseline justify-between border-t border-hairline pt-1.5">
            <dt className="font-medium text-fg">Amount payable</dt>
            <dd className="text-base font-semibold nums text-fg">
              {fmtMoney(inv.netPayable)}
            </dd>
          </div>
          {inv.status !== 'VOID' && (
            <>
              <TotalRow label="Received" value={-inv.amountPaid} />
              <div className="flex items-baseline justify-between border-t border-hairline pt-1.5">
                <dt className="font-medium text-fg">Balance</dt>
                <dd
                  className={`text-base font-semibold nums ${
                    inv.overdue ? 'text-red-600' : 'text-fg'
                  }`}
                >
                  {fmtMoney(inv.balance)}
                </dd>
              </div>
            </>
          )}
        </dl>
      </div>

      {inv.notes && (
        <Detail label="Notes">
          <p className="whitespace-pre-line text-fg">{inv.notes}</p>
        </Detail>
      )}

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
          Payments received
        </p>
        {livePayments.length === 0 && payments.length === 0 ? (
          <p className="text-sm text-fg-muted">Nothing received against this invoice yet.</p>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => (
              <div
                key={p.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline p-3 text-sm ${
                  p.voidedAt ? 'opacity-55' : ''
                }`}
              >
                <div className="min-w-0">
                  <p className={p.voidedAt ? 'text-fg line-through' : 'font-medium text-fg'}>
                    {fmtMoney(Number(p.amount))}
                    <span className="ml-2 font-normal text-fg-muted">{fmtDate(p.paymentDate)}</span>
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {p.receiptNo ?? 'No receipt number'}
                    {p.referenceNo ? ` · Ref ${p.referenceNo}` : ''}
                    {p.voidedAt ? ` · Voided${p.voidReason ? `: ${p.voidReason}` : ''}` : ''}
                  </p>
                </div>
                {p.receiptPdfUrl && !p.voidedAt && (
                  <a
                    href={p.receiptPdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                  >
                    <Receipt size={12} /> Official receipt
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-sm">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      {children}
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="nums text-fg">{fmtMoney(value)}</dd>
    </div>
  );
}
