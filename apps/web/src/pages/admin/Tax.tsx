import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck, Landmark } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type {
  IncomeTaxInstalment,
  IncomeTaxReturn,
  IncomeTaxYearRecords,
  OutstandingCertificate,
  TaxPosition,
  VatFiling,
} from '@/lib/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { QueryState } from '@/components/ui/query-state';
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
  const [filingOpen, setFilingOpen] = useState(false);

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
  const filingQuery = useQuery({
    queryKey: ['tax', 'vat-filing', month],
    queryFn: () =>
      api<VatFiling | null>(`/tax/vat-filing?from=${from.toISOString()}&to=${to.toISOString()}`),
  });
  const { data: filing } = filingQuery;
  const certsQuery = useQuery({
    queryKey: ['tax', 'certificates'],
    queryFn: () => api<OutstandingCertificate[]>('/tax/certificates-outstanding'),
  });
  const { data: certs } = certsQuery;

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

  const recordFiling = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/tax/vat-filing', {
        method: 'POST',
        body: { from: from.toISOString(), to: to.toISOString(), ...body },
      }),
    onSuccess: () => {
      toast.success('Filing recorded.');
      void qc.invalidateQueries({ queryKey: ['tax', 'vat-filing'] });
      setFilingOpen(false);
    },
    onError: (e) => toast.error(errText(e, 'The filing was not recorded.')),
  });

  const vat = data?.vat;
  const w = data?.withholding;
  // VAT is due the 20th of the month following the period. Only worth
  // flagging once that date is actually in the past — a fresh, unfiled
  // current month is normal, not overdue.
  const vatDueDate = new Date(to.getFullYear(), to.getMonth() + 1, 20);
  const vatOverdue = !filing?.filedAt && vatDueDate < new Date();

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

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2">
            <div className="text-xs">
              {filing?.paidAt ? (
                <span className="text-fg-muted">
                  Paid {fmtDate(filing.paidAt)}
                  {filing.itaxAckNo ? ` · Ack ${filing.itaxAckNo}` : ''}
                </span>
              ) : filing?.filedAt ? (
                <span className="text-fg-muted">
                  Filed {fmtDate(filing.filedAt)}, not yet marked paid
                  {filing.itaxAckNo ? ` · Ack ${filing.itaxAckNo}` : ''}
                </span>
              ) : (
                <span className={vatOverdue ? 'font-medium text-danger-fg' : 'text-fg-muted'}>
                  Not yet filed{vatOverdue ? ' — overdue (due the 20th)' : ''}
                </span>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={() => setFilingOpen(true)}>
              Record filing
            </Button>
          </div>
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
        <QueryState query={certsQuery} rows={3} noun="certificates" />

        {certs?.length === 0 ? (
          <Empty icon={FileCheck}>
            <p className="font-medium text-fg">Nothing outstanding</p>
            <p className="mt-1 max-w-sm text-fg-muted">
              Every withholding deduction a client has made has a certificate recorded against
              it.
            </p>
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Receipt</Th>
                <Th priority="sm">Client / site</Th>
                <Th priority="sm">Paid</Th>
                <Th className="text-right">Withheld</Th>
                <Th priority="lg" className="text-right">Waiting</Th>
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
                  <Td priority="sm">
                    <p className="text-fg">{c.project.clientName}</p>
                    <p className="text-xs text-fg-subtle">{c.project.name}</p>
                  </Td>
                  <Td priority="sm" className="whitespace-nowrap">{fmtDate(c.paymentDate)}</Td>
                  <Td className="text-right font-medium tabular-nums">{fmtMoney(c.withheld)}</Td>
                  <Td priority="lg" className="text-right tabular-nums">
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

      <IncomeTaxSection />

      <p className="flex items-start gap-2 text-xs text-fg-subtle">
        <Landmark size={14} className="mt-0.5 shrink-0" />
        These figures report what has been entered against each invoice, bill and receipt. They do
        not decide what is legally due, and they are not a filed return — check them against your
        records before submitting anything to KRA.
      </p>

      <Dialog
        open={filingOpen}
        onClose={() => {
          setFilingOpen(false);
          recordFiling.reset();
        }}
        title="Record VAT filing"
      >
        <form
          key={filing?.id ?? month}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const filedAt = String(fd.get('filedAt') || '');
            const paidAt = String(fd.get('paidAt') || '');
            recordFiling.mutate({
              filedAt: filedAt || null,
              paidAt: paidAt || null,
              itaxAckNo: String(fd.get('itaxAckNo') || '').trim() || null,
              notes: String(fd.get('notes') || '').trim() || null,
            });
          }}
          className="space-y-3"
        >
          <p className="text-sm text-fg-muted">
            Net VAT for {month}: {fmtMoney(Math.abs(vat?.netVatPayable ?? 0))}
            {(vat?.netVatPayable ?? 0) < 0 ? ' (credit carried forward)' : ' payable'}.
          </p>
          <Field label="Filed on">
            <Input name="filedAt" type="date" defaultValue={filing?.filedAt?.slice(0, 10) ?? ''} />
          </Field>
          <Field label="Paid on">
            <Input name="paidAt" type="date" defaultValue={filing?.paidAt?.slice(0, 10) ?? ''} />
          </Field>
          <Field label="iTax acknowledgement no.">
            <Input name="itaxAckNo" defaultValue={filing?.itaxAckNo ?? ''} />
          </Field>
          <Field label="Notes">
            <Textarea name="notes" rows={2} defaultValue={filing?.notes ?? ''} />
          </Field>
          {recordFiling.isError && (
            <p className="text-sm text-danger-fg">{errText(recordFiling.error, 'Failed to save')}</p>
          )}
          <Button type="submit" className="w-full" disabled={recordFiling.isPending}>
            Save
          </Button>
        </form>
      </Dialog>

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

/**
 * Corporation Tax: the four instalment payments and the annual return, for
 * one tax year at a time. Hidden entirely (with a pointer to Settings) unless
 * the company has switched this on — most of what's here would otherwise be
 * an empty, unexplained set of zero-value rows.
 */
function IncomeTaxSection() {
  const qc = useQueryClient();
  const [taxYear, setTaxYear] = useState(new Date().getFullYear());
  const [editingInstalment, setEditingInstalment] = useState<IncomeTaxInstalment | null>(null);
  const [editingReturn, setEditingReturn] = useState<IncomeTaxReturn | null>(null);

  const query = useQuery({
    queryKey: ['income-tax', taxYear],
    queryFn: () => api<IncomeTaxYearRecords>(`/income-tax/${taxYear}`),
  });
  const { data } = query;

  const saveInstalment = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/income-tax/instalments/${id}`, { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('Instalment updated.');
      void qc.invalidateQueries({ queryKey: ['income-tax', taxYear] });
      setEditingInstalment(null);
    },
    onError: (e) => toast.error(errText(e, 'The instalment was not saved.')),
  });

  const saveReturn = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/income-tax/return/${taxYear}`, { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('Return updated.');
      void qc.invalidateQueries({ queryKey: ['income-tax', taxYear] });
      setEditingReturn(null);
    },
    onError: (e) => toast.error(errText(e, 'The return was not saved.')),
  });

  if (!query.isFetched && !data) return null; // nothing to show while first loading — no layout jump
  if (data && !data.config.enabled) return null;

  const ret = data?.return;
  const returnDue = new Date(taxYear + 1, 5, 30); // 30 June of the following year
  const returnOverdue = ret && !ret.filedAt && returnDue < new Date();

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h2 className="text-sm font-semibold text-fg">Income tax (Corporation Tax)</h2>
          <p className="text-xs text-fg-muted">Instalment payments and the annual return</p>
        </div>
        <Field label="Tax year">
          <Input
            type="number"
            value={taxYear}
            onChange={(e) => setTaxYear(Number(e.target.value) || taxYear)}
            className="w-28"
          />
        </Field>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">Instalment tax</CardTitle>
          <p className="text-xs text-fg-muted">
            Four advance payments toward the year's estimated tax. Due dates are a starting point —
            confirm the current date on iTax.
          </p>
        </CardHeader>
        <QueryState query={query} rows={4} noun="instalments" />
        {data && (
          <Table>
            <thead>
              <tr>
                <Th>Due</Th>
                <Th priority="sm" className="text-right">Estimated tax for year</Th>
                <Th className="text-right">Due this instalment</Th>
                <Th priority="lg">Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.instalments.map((i) => {
                const overdue = !i.paidAt && new Date(i.dueDate) < new Date();
                return (
                  <tr key={i.id}>
                    <Td className="whitespace-nowrap">
                      #{i.instalmentNo} · {fmtDate(i.dueDate)}
                    </Td>
                    <Td priority="sm" className="text-right tabular-nums">
                      {fmtMoney(i.estimatedTaxForYear)}
                    </Td>
                    <Td className="text-right font-medium tabular-nums">
                      {fmtMoney(i.estimatedTaxForYear / 4)}
                    </Td>
                    <Td priority="lg">
                      {i.paidAt ? (
                        <span className="text-fg-muted">
                          Paid {fmtDate(i.paidAt)}
                          {i.itaxAckNo ? ` · ${i.itaxAckNo}` : ''}
                        </span>
                      ) : (
                        <span className={overdue ? 'font-medium text-danger-fg' : 'text-fg-muted'}>
                          {overdue ? 'Overdue' : 'Not yet paid'}
                        </span>
                      )}
                    </Td>
                    <Td className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditingInstalment(i)}>
                        Record payment
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {ret && (
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Annual return</CardTitle>
            <p className="text-xs text-fg-muted">
              Due 30 June {taxYear + 1}. Taxable profit is a starting suggestion from the company's
              own project figures — it excludes company expenses and any prior-year losses, so
              correct it before relying on it.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            <Line label="Taxable profit (estimate)" value={ret.taxableProfitEstimate} />
            <div className="border-t border-hairline pt-2">
              <Line label="Tax due" value={ret.taxDue} strong />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className={returnOverdue ? 'text-xs font-medium text-danger-fg' : 'text-xs text-fg-muted'}>
                {ret.paidAt
                  ? `Paid ${fmtDate(ret.paidAt)}${ret.itaxAckNo ? ` · ${ret.itaxAckNo}` : ''}`
                  : ret.filedAt
                    ? `Filed ${fmtDate(ret.filedAt)}, not yet marked paid`
                    : returnOverdue
                      ? 'Not yet filed — overdue'
                      : 'Not yet filed'}
              </span>
              <Button size="sm" variant="outline" onClick={() => setEditingReturn(ret)}>
                Record filing
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={!!editingInstalment}
        onClose={() => {
          setEditingInstalment(null);
          saveInstalment.reset();
        }}
        title={editingInstalment ? `Instalment #${editingInstalment.instalmentNo}` : ''}
      >
        {editingInstalment && (
          <form
            key={editingInstalment.id}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const paidAt = String(fd.get('paidAt') || '');
              saveInstalment.mutate({
                id: editingInstalment.id,
                body: {
                  dueDate: new Date(String(fd.get('dueDate'))).toISOString(),
                  estimatedTaxForYear: Number(fd.get('estimatedTaxForYear')),
                  amountPaid: Number(fd.get('amountPaid')),
                  paidAt: paidAt || null,
                  itaxAckNo: String(fd.get('itaxAckNo') || '').trim() || null,
                  notes: String(fd.get('notes') || '').trim() || null,
                },
              });
            }}
            className="space-y-3"
          >
            <Field label="Due date">
              <Input
                name="dueDate"
                type="date"
                defaultValue={editingInstalment.dueDate.slice(0, 10)}
                required
              />
            </Field>
            <Field label="Estimated tax for the year">
              <Input
                name="estimatedTaxForYear"
                type="number"
                min="0"
                step="0.01"
                defaultValue={editingInstalment.estimatedTaxForYear}
              />
            </Field>
            <Field label="Amount paid this instalment">
              <Input
                name="amountPaid"
                type="number"
                min="0"
                step="0.01"
                defaultValue={editingInstalment.amountPaid}
              />
            </Field>
            <Field label="Paid on">
              <Input name="paidAt" type="date" defaultValue={editingInstalment.paidAt?.slice(0, 10) ?? ''} />
            </Field>
            <Field label="iTax acknowledgement no.">
              <Input name="itaxAckNo" defaultValue={editingInstalment.itaxAckNo ?? ''} />
            </Field>
            <Field label="Notes">
              <Textarea name="notes" rows={2} defaultValue={editingInstalment.notes ?? ''} />
            </Field>
            {saveInstalment.isError && (
              <p className="text-sm text-danger-fg">{errText(saveInstalment.error, 'Failed to save')}</p>
            )}
            <Button type="submit" className="w-full" disabled={saveInstalment.isPending}>
              Save
            </Button>
          </form>
        )}
      </Dialog>

      <Dialog
        open={!!editingReturn}
        onClose={() => {
          setEditingReturn(null);
          saveReturn.reset();
        }}
        title="Annual return"
      >
        {editingReturn && (
          <form
            key={editingReturn.id}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const filedAt = String(fd.get('filedAt') || '');
              const paidAt = String(fd.get('paidAt') || '');
              saveReturn.mutate({
                taxableProfitEstimate: Number(fd.get('taxableProfitEstimate')),
                taxDue: Number(fd.get('taxDue')),
                filedAt: filedAt || null,
                paidAt: paidAt || null,
                itaxAckNo: String(fd.get('itaxAckNo') || '').trim() || null,
                notes: String(fd.get('notes') || '').trim() || null,
              });
            }}
            className="space-y-3"
          >
            <Field label="Taxable profit (estimate)">
              <Input
                name="taxableProfitEstimate"
                type="number"
                step="0.01"
                defaultValue={editingReturn.taxableProfitEstimate}
              />
            </Field>
            <Field label="Tax due">
              <Input
                name="taxDue"
                type="number"
                min="0"
                step="0.01"
                defaultValue={editingReturn.taxDue}
              />
            </Field>
            <Field label="Filed on">
              <Input name="filedAt" type="date" defaultValue={editingReturn.filedAt?.slice(0, 10) ?? ''} />
            </Field>
            <Field label="Paid on">
              <Input name="paidAt" type="date" defaultValue={editingReturn.paidAt?.slice(0, 10) ?? ''} />
            </Field>
            <Field label="iTax acknowledgement no.">
              <Input name="itaxAckNo" defaultValue={editingReturn.itaxAckNo ?? ''} />
            </Field>
            <Field label="Notes">
              <Textarea name="notes" rows={2} defaultValue={editingReturn.notes ?? ''} />
            </Field>
            {saveReturn.isError && (
              <p className="text-sm text-danger-fg">{errText(saveReturn.error, 'Failed to save')}</p>
            )}
            <Button type="submit" className="w-full" disabled={saveReturn.isPending}>
              Save
            </Button>
          </form>
        )}
      </Dialog>
    </>
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
