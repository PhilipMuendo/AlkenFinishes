import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Plus, Receipt } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { BudgetCategory, Expense } from '@/lib/types';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th, Empty } from '@/components/ui/table';

const CATEGORIES: BudgetCategory[] = ['MATERIALS', 'LABOUR', 'TRANSPORT', 'OTHER'];

export function ExpensesPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canBrowse = user?.role === 'SUPERADMIN';
  const [open, setOpen] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  const { data: expenses } = useQuery({
    queryKey: ['expenses', projectId],
    queryFn: () => api<Expense[]>(`/projects/${projectId}/expenses`),
    enabled: canBrowse,
  });

  const create = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/expenses`, { formData }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses', projectId] });
      void qc.invalidateQueries({ queryKey: ['analytics', 'project', projectId] });
      void qc.invalidateQueries({ queryKey: ['analytics', 'company'] });
      setOpen(false);
      if (!canBrowse) {
        setJustSubmitted(true);
        setTimeout(() => setJustSubmitted(false), 5000);
      }
    },
  });

  // Supervisors can log a purchase (money leaves their hand on site and
  // needs a receipt captured there) but don't get a ledger to browse —
  // project spend history is office-only. Just a submit form + confirmation.
  if (!canBrowse) {
    return (
      <div className="space-y-4">
        {justSubmitted && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
            Expense recorded and sent to the office.
          </div>
        )}
        <Card>
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <Receipt size={28} className="text-fg-subtle" />
            <div>
              <p className="font-medium text-fg">Log a site purchase</p>
              <p className="mt-1 max-w-xs text-sm text-fg-muted">
                Record what you spent and attach a receipt. The office handles the project&rsquo;s
                budget and spending history from here.
              </p>
            </div>
            <Button size="lg" onClick={() => setOpen(true)}>
              <Plus size={16} /> Record expense
            </Button>
          </div>
        </Card>

        <Dialog open={open} onClose={() => setOpen(false)} title="Record expense">
          <ExpenseForm onSubmit={(fd) => create.mutate(fd)} pending={create.isPending} error={create.error} />
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> Record expense
        </Button>
      </div>

      {expenses?.length === 0 ? (
        <Empty>No expenses recorded for this project</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Category</Th>
              <Th>Description</Th>
              <Th className="text-right">Amount</Th>
              <Th>By</Th>
              <Th>Receipt</Th>
            </tr>
          </thead>
          <tbody>
            {expenses?.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap">{fmtDate(e.expenseDate)}</Td>
                <Td>
                  <Badge>{e.category}</Badge>
                </Td>
                <Td>{e.description}</Td>
                <Td className="text-right font-medium tabular-nums">
                  {fmtMoney(Number(e.amount))}
                </Td>
                <Td>{e.submittedBy.name}</Td>
                <Td>
                  {e.receiptUrl ? (
                    <a
                      href={e.receiptUrl}
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
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="Record expense">
        <ExpenseForm onSubmit={(fd) => create.mutate(fd)} pending={create.isPending} error={create.error} />
      </Dialog>
    </div>
  );
}

function ExpenseForm({
  onSubmit,
  pending,
  error,
}: {
  onSubmit: (formData: FormData) => void;
  pending: boolean;
  error: unknown;
}) {
  return (
    <form
      key="expense-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
      }}
      className="space-y-3"
    >
      <Field label="Category">
        <Select name="category" required>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.charAt(0) + c.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Amount (KES)">
        <Input name="amount" type="number" min="1" step="0.01" inputMode="decimal" required />
      </Field>
      <Field label="Description">
        <Textarea name="description" required placeholder="20 bags of cement" />
      </Field>
      <Field label="Date">
        <Input name="expenseDate" type="date" defaultValue={todayISO()} required />
      </Field>
      <Field label="Receipt photo / document">
        <Input name="receipt" type="file" accept="image/*,.pdf" capture="environment" />
      </Field>
      {error != null && (
        <p className="text-sm text-red-600">
          {error instanceof ApiRequestError ? error.message : 'Failed to save expense'}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        Save expense
      </Button>
    </form>
  );
}
