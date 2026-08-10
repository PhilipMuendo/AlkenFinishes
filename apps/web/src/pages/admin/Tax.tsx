import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck, Landmark } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { OutstandingCertificate, TaxPosition } from '@/lib/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

/**
 * The company's tax position.
 *
 * Four obligations shown side by side and never netted into one number: VAT
 * charged out, VAT charged to us, tax we hold for KRA, and tax already paid to
 * KRA on our behalf. Netting them would be wrong in both directions — money
 * owed is not reduced by credits we cannot yet claim, and a credit in hand is
 * not cancelled by a liability falling due on another date.
 *
 * Everything here reports what was entered. It does not decide what is legally
 * due, and it is not a substitute for a filed return.
 */

const monthValue = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function TaxPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(monthValue(new Date()));
  const [certifying, setCertifying] = useState<OutstandingCertificate | null>(null);

  const [year, mon] = month.split('-').map(Number);
  const from = new Date(year, mon - 1, 1);
  const to = new Date(year, mon, 0, 23, 59, 59);

  const { data } = useQuery({
    queryKey: ['tax', 'position', month],
    queryFn: () =>
      api<TaxPosition>(
        `/tax/position?from=${from.toISOString()}&to=${to.toISOString()}`,
      ),
  });
  const { data: certs } = useQuery({
    queryKey: ['tax', 'certificates'],
    queryFn: () => api<OutstandingCertificate[]>('/tax/certificates-outstanding'),
  });

  const recordCert = useMutation({
    mutationFn: ({ id, whtCertNo }: { id: string; whtCertNo: string }) =>
      api(`/tax/payments/${id}/certificate`, { body: { whtCertNo } }),
    onSuccess: () => {
      toast.success('Certificate recorded. This tax can now be claimed against what you owe KRA.');
      void qc.invalidateQueries({ queryKey: ['tax'] });
      setCertifying(null);
    },
    onError: (e) => toast.error(errText(e, 'The certificate was not recorded.')),
  });

  const vat = data?.vat;
  const w = data?.withholding;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">Tax position</h1>
          <p className="text-sm text-fg-muted">
            VAT and withholding across sales and purchases
          </p>
        </div>
        <Field label="VAT period">
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-44"
          />
        </Field>
      </div>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">VAT for the period</CardTitle>
          <p className="text-xs text-fg-muted">
            On invoices issued and supplier bills dated in the month
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          <Line label="Output VAT charged to clients" value={vat?.outputVat ?? 0} />
          <Line
            label="Input VAT reclaimable"
            value={-(vat?.inputVatReclaimable ?? 0)}
            hint={`${vat?.billCount ?? 0} supplier bill${vat?.billCount === 1 ? '' : 's'}`}
          />
          <div className="border-t border-hairline pt-2">
            <Line
              label={
                (vat?.netVatPayable ?? 0) >= 0 ? 'Net VAT payable to KRA' : 'VAT credit carried forward'
              }
              value={Math.abs(vat?.netVatPayable ?? 0)}
              strong
            />
          </div>
          {(vat?.inputVatUnsupported ?? 0) > 0 && (
            <p className="rounded-md border border-warn-hairline bg-warn-surface px-2.5 py-2 text-xs text-warn-fg">
              {fmtMoney(vat!.inputVatUnsupported)} of input VAT has no supplier tax invoice
              recorded against it, so it is not counted as reclaimable. Chase the ETR invoices, or
              tick the box on the bill once you have them.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Tax we withheld from suppliers</CardTitle>
            <p className="text-xs text-fg-muted">Their money, held by us, owed to KRA</p>
          </CardHeader>
          <CardContent className="space-y-2">
            <Line label="Withheld in the period" value={w?.withheldFromSuppliers ?? 0} />
            <Line
              label="Not yet remitted"
              value={w?.notYetRemitted ?? 0}
              strong
              tone={(w?.notYetRemitted ?? 0) > 0 ? 'warn' : undefined}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Tax clients withheld from us</CardTitle>
            <p className="text-xs text-fg-muted">Already paid to KRA on our behalf</p>
          </CardHeader>
          <CardContent className="space-y-2">
            <Line label="Withheld in the period" value={w?.withheldByClients ?? 0} />
            <Line
              label="No certificate yet"
              value={w?.certificatesOutstanding ?? 0}
              strong
              tone={(w?.certificatesOutstanding ?? 0) > 0 ? 'warn' : undefined}
              hint={
                w?.certificatesOutstandingCount
                  ? `${w.certificatesOutstandingCount} receipt${w.certificatesOutstandingCount === 1 ? '' : 's'}`
                  : undefined
              }
            />
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">Certificates to chase</CardTitle>
          <p className="text-xs text-fg-muted">
            Tax already surrendered to KRA that cannot be claimed until the certificate arrives.
            Oldest first — all periods, not just this month.
          </p>
        </CardHeader>
        {certs?.length === 0 ? (
          <CardContent>
            <Empty icon={FileCheck}>
              <p className="font-medium text-fg">Nothing outstanding</p>
              <p className="mt-1 max-w-sm text-fg-muted">
                Every withholding deduction a client has made has a certificate recorded against
                it.
              </p>
            </Empty>
          </CardContent>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Receipt</Th>
                <Th>Client / project</Th>
                <Th>Paid</Th>
                <Th className="text-right">Withheld</Th>
                <Th className="text-right">Waiting</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {certs?.map((c) => (
                <tr key={c.id}>
                  <Td className="whitespace-nowrap font-medium text-fg">
                    {c.receiptNo ?? '—'}
                    {c.invoice?.invoiceNo && (
                      <p className="text-xs font-normal text-fg-subtle">{c.invoice.invoiceNo}</p>
                    )}
                  </Td>
                  <Td>
                    <p className="text-fg">{c.project.clientName}</p>
                    <p className="text-xs text-fg-subtle">{c.project.name}</p>
                  </Td>
                  <Td className="whitespace-nowrap">{fmtDate(c.paymentDate)}</Td>
                  <Td className="text-right font-medium tabular-nums">{fmtMoney(c.withheld)}</Td>
                  <Td className="text-right tabular-nums">
                    <span className={c.daysWaiting > 60 ? 'text-danger-fg' : 'text-fg-muted'}>
                      {c.daysWaiting}d
                    </span>
                  </Td>
                  <Td className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setCertifying(c)}>
                      Record certificate
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <p className="flex items-start gap-2 text-xs text-fg-subtle">
        <Landmark size={14} className="mt-0.5 shrink-0" />
        These figures report what has been entered against each invoice, bill and receipt. They do
        not decide what is legally due, and they are not a filed return — check them against your
        records before submitting anything to KRA.
      </p>

      <Dialog
        open={!!certifying}
        onClose={() => {
          setCertifying(null);
          recordCert.reset();
        }}
        title="Record withholding certificate"
      >
        {certifying && (
          <form
            key={certifying.id}
            onSubmit={(e) => {
              e.preventDefault();
              recordCert.mutate({
                id: certifying.id,
                whtCertNo: String(new FormData(e.currentTarget).get('whtCertNo')),
              });
            }}
            className="space-y-3"
          >
            <p className="text-sm text-fg-muted">
              {fmtMoney(certifying.withheld)} withheld by {certifying.project.clientName} on{' '}
              {fmtDate(certifying.paymentDate)}. Once the certificate is recorded this becomes a
              credit you can claim.
            </p>
            <Field label="Certificate number">
              <Input name="whtCertNo" required autoFocus />
            </Field>
            {recordCert.isError && (
              <p className="text-sm text-danger-fg">
                {recordCert.error instanceof ApiRequestError
                  ? recordCert.error.message
                  : 'Failed to record it'}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={recordCert.isPending}>
              Record certificate
            </Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}

function Line({
  label,
  value,
  hint,
  strong,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  strong?: boolean;
  tone?: 'warn';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      {/* min-w-0 lets a long label wrap instead of pushing the figure off a
          narrow screen; the figure itself never wraps. */}
      <span className={`min-w-0 ${strong ? 'font-medium text-fg' : 'text-fg-muted'}`}>
        {label}
        {hint && <span className="ml-1.5 text-xs text-fg-subtle">{hint}</span>}
      </span>
      <span
        className={`shrink-0 whitespace-nowrap tabular-nums ${
          strong ? 'text-lg font-semibold' : ''
        } ${tone === 'warn' && value > 0 ? 'text-warn-fg' : 'text-fg'}`}
      >
        {value < 0 ? `(${fmtMoney(Math.abs(value))})` : fmtMoney(value)}
      </span>
    </div>
  );
}
