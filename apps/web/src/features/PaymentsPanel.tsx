import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Receipt } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import type { PaymentMethod, PaymentsSummary } from '@/lib/types';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { HealthBadge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, Td, Th, Empty } from '@/components/ui/table';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank Transfer',
  MPESA: 'M-Pesa',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};

export function PaymentsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [dueDate, setDueDate] = useState('');

  const { data: summary } = useQuery({
    queryKey: ['payments', 'summary', projectId],
    queryFn: () => api<PaymentsSummary>(`/projects/${projectId}/payments/summary`),
  });

  useEffect(() => {
    setDueDate(summary?.balanceDueDate ? summary.balanceDueDate.slice(0, 10) : '');
  }, [summary?.balanceDueDate]);

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['payments', 'summary', projectId] });
    void qc.invalidateQueries({ queryKey: ['analytics', 'company'] });
  };

  const createPayment = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/payments`, { formData }),
    onSuccess: () => {
      invalidateAll();
      setAddOpen(false);
    },
  });

  const saveDueDate = useMutation({
    mutationFn: () =>
      api(`/projects/${projectId}/payments/due-date`, {
        method: 'PUT',
        body: { balanceDueDate: dueDate || null },
      }),
    onSuccess: invalidateAll,
  });

  const deletePayment = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/payments/${id}`, { method: 'DELETE' }),
    onSuccess: invalidateAll,
  });

  const hasDeposit = !!summary?.deposit;
  const percentPaid = summary && summary.contractValue > 0
    ? (summary.totalPaid / summary.contractValue) * 100
    : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Contract &amp; deposit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-lg font-semibold tabular-nums text-fg">
            {fmtMoney(summary?.contractValue ?? 0)}
          </p>
          {summary?.deposit ? (
            <div className="text-sm">
              <p className="text-fg">
                Deposit paid: <span className="font-medium">{fmtMoney(Number(summary.deposit.amount))}</span>{' '}
                via {METHOD_LABEL[summary.deposit.method]} on {fmtDate(summary.deposit.paymentDate)}
              </p>
              {summary.deposit.notes && (
                <p className="mt-1 text-xs text-fg-muted">{summary.deposit.notes}</p>
              )}
              {summary.deposit.receiptUrl && (
                <a
                  href={summary.deposit.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                >
                  <Receipt size={12} /> View receipt
                </a>
              )}
            </div>
          ) : (
            <p className="text-sm text-fg-muted">No deposit recorded yet</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending balance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-2xl font-semibold tabular-nums text-fg">
            {fmtMoney(summary?.pendingBalance ?? 0)}
          </p>
          <Progress value={percentPaid} health="GREEN" />
          <p className="text-xs text-fg-muted">
            {fmtMoney(summary?.totalPaid ?? 0)} paid of {fmtMoney(summary?.contractValue ?? 0)}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Balance due date (as per contract)">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Button onClick={() => saveDueDate.mutate()} disabled={saveDueDate.isPending}>
              Save due date
            </Button>
            {summary && <HealthBadge health={summary.dueDateHealth} />}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={16} /> Record payment
        </Button>
      </div>

      {summary && summary.installments.length === 0 ? (
        <Empty>No subsequent payments recorded yet</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Method</Th>
              <Th className="text-right">Amount</Th>
              <Th>Notes</Th>
              <Th>Receipt</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {summary?.installments.map((p) => (
              <tr key={p.id}>
                <Td className="whitespace-nowrap">{fmtDate(p.paymentDate)}</Td>
                <Td>{METHOD_LABEL[p.method]}</Td>
                <Td className="text-right font-medium tabular-nums">
                  {fmtMoney(Number(p.amount))}
                </Td>
                <Td>{p.notes ?? <span className="text-fg-subtle">—</span>}</Td>
                <Td>
                  {p.receiptUrl ? (
                    <a
                      href={p.receiptUrl}
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
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => deletePayment.mutate(p.id)}
                    disabled={deletePayment.isPending}
                  >
                    Delete
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Record payment">
        <form
          key={String(addOpen)}
          onSubmit={(e) => {
            e.preventDefault();
            createPayment.mutate(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <Field label="Type">
            <Select name="type" required defaultValue={hasDeposit ? 'INSTALLMENT' : 'DEPOSIT'}>
              <option value="DEPOSIT" disabled={hasDeposit}>
                Deposit{hasDeposit ? ' (already recorded)' : ''}
              </option>
              <option value="INSTALLMENT">Subsequent payment</option>
            </Select>
          </Field>
          <Field label="Amount (KES)">
            <Input name="amount" type="number" min="1" step="0.01" inputMode="decimal" required />
          </Field>
          <Field label="Method">
            <Select name="method" required>
              {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date">
            <Input name="paymentDate" type="date" defaultValue={todayISO()} required />
          </Field>
          <Field label="Notes (optional)">
            <Textarea name="notes" placeholder="e.g. Second installment on completion of roofing" />
          </Field>
          <Field label="Receipt (optional)">
            <Input name="receipt" type="file" accept="image/*,.pdf" capture="environment" />
          </Field>
          {createPayment.isError && (
            <p className="text-sm text-red-600">
              {createPayment.error instanceof ApiRequestError && createPayment.error.status === 409
                ? 'A deposit has already been recorded for this project'
                : 'Failed to save payment'}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={createPayment.isPending}>
            Save payment
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
