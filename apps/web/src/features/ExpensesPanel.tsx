import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import type { BudgetCategory, Expense } from '@/lib/types';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th, Empty } from '@/components/ui/table';

const CATEGORIES: BudgetCategory[] = ['MATERIALS', 'LABOUR', 'TRANSPORT', 'OTHER'];

export function ExpensesPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: expenses } = useQuery({
    queryKey: ['expenses', projectId],
    queryFn: () => api<Expense[]>(`/projects/${projectId}/expenses`),
  });

  const create = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/expenses`, { formData }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses', projectId] });
      void qc.invalidateQueries({ queryKey: ['analytics', 'project', projectId] });
      void qc.invalidateQueries({ queryKey: ['analytics', 'company'] });
      setOpen(false);
    },
  });

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
                    <span className="text-slate-400">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="Record expense">
        <form
          key={String(open)} // remount on open: no stale values or stale file input
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(new FormData(e.currentTarget));
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
          {create.isError && <p className="text-sm text-red-600">Failed to save expense</p>}
          <Button type="submit" size="lg" className="w-full" disabled={create.isPending}>
            Save expense
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
