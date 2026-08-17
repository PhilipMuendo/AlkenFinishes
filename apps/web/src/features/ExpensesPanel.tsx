import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Plus, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/lib/auth';
import type { Expense, ExpenseCategory } from '@/lib/types';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { expenseStatusTone } from '@/lib/tone';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th, Empty } from '@/components/ui/table';

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'MATERIALS', label: 'Materials' },
  { value: 'LABOUR', label: 'Labour (cash payout)' },
  { value: 'TRANSPORT', label: 'Transport' },
  { value: 'EQUIPMENT_HIRE', label: 'Equipment hire' },
  { value: 'SUBCONTRACTOR', label: 'Subcontractor' },
  { value: 'SITE_OVERHEADS', label: 'Site overheads' },
  { value: 'OTHER', label: 'Other' },
];


export function ExpensesPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canBrowse = user?.role === 'SUPERADMIN';
  const [open, setOpen] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [rejecting, setRejecting] = useState<Expense | null>(null);

  const { data: expenses } = useQuery({
    queryKey: queryKeys.expenses.byProject(projectId),
    queryFn: () => api<Expense[]>(`/projects/${projectId}/expenses`),
    enabled: canBrowse,
  });
  const { data: mine } = useQuery({
    queryKey: queryKeys.expenses.mine(projectId),
    queryFn: () => api<Expense[]>(`/projects/${projectId}/expenses/mine`),
    enabled: !canBrowse,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.expenses.byProject(projectId) });
    void qc.invalidateQueries({ queryKey: queryKeys.analytics.project(projectId) });
    void qc.invalidateQueries({ queryKey: queryKeys.analytics.company() });
  };

  const create = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/expenses`, { formData }),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      if (!canBrowse) {
        setJustSubmitted(true);
        setTimeout(() => setJustSubmitted(false), 5000);
      }
    },
  });

  const approve = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/expenses/${id}/approve`, { body: {} }),
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/projects/${projectId}/expenses/${id}/reject`, { body: { reason } }),
    onSuccess: () => {
      invalidate();
      setRejecting(null);
    },
  });

  // Supervisors can log a purchase (money leaves their hand on site and needs
  // a receipt captured there) but don't get the project's full ledger — that's
  // office-only. They see their own claims and whether the office accepted
  // them, so a rejection doesn't vanish without a trace.
  if (!canBrowse) {
    return (
      <div className="space-y-4">
        {justSubmitted && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
            Expense recorded and sent to the office.
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> Record expense
          </Button>
        </div>

        {mine?.length === 0 ? (
          <Card>
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <Receipt size={28} className="text-fg-subtle" />
              <p className="font-medium text-fg">No expenses logged yet</p>
              <p className="max-w-xs text-sm text-fg-muted">
                Record what you spent and attach a receipt. The office reviews it from here.
              </p>
            </div>
          </Card>
        ) : (
          <div className="space-y-2">
            {mine?.map((e) => (
              <Card key={e.id} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-fg">{e.description}</p>
                    <p className="text-xs text-fg-subtle">
                      {fmtDate(e.expenseDate)} ·{' '}
                      {CATEGORIES.find((c) => c.value === e.expenseCategory)?.label}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold nums text-fg">{fmtMoney(e.amount)}</p>
                    <Badge tone={expenseStatusTone[e.status]} className="mt-1 capitalize">
                      {e.status.toLowerCase()}
                    </Badge>
                  </div>
                </div>
                {e.rejectReason && (
                  <p className="mt-2 text-xs text-red-600">Declined: {e.rejectReason}</p>
                )}
              </Card>
            ))}
          </div>
        )}

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
              <Th>Status</Th>
              <Th>Receipt</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {expenses?.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap">{fmtDate(e.expenseDate)}</Td>
                <Td>
                  <Badge>{CATEGORIES.find((c) => c.value === e.expenseCategory)?.label ?? e.expenseCategory}</Badge>
                </Td>
                <Td>{e.description}</Td>
                <Td className="text-right font-medium nums">{fmtMoney(e.amount)}</Td>
                <Td>{e.submittedBy.name}</Td>
                <Td>
                  <Badge tone={expenseStatusTone[e.status]} className="capitalize">
                    {e.status.toLowerCase()}
                  </Badge>
                  {e.rejectReason && <p className="mt-0.5 text-xs text-fg-subtle">{e.rejectReason}</p>}
                </Td>
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
                <Td className="text-right">
                  {e.status === 'PENDING' && (
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(e.id)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRejecting(e)}>
                        Reject
                      </Button>
                    </div>
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

      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} title="Decline this claim">
        <form
          key={rejecting?.id ?? 'none'}
          onSubmit={(e) => {
            e.preventDefault();
            reject.mutate({
              id: rejecting!.id,
              reason: String(new FormData(e.currentTarget).get('reason')),
            });
          }}
          className="space-y-3"
        >
          <Field label="Why?">
            <Textarea name="reason" required rows={2} autoFocus />
          </Field>
          <FormError error={reject.error} fallback="Failed to save" />
          <Button type="submit" className="w-full" disabled={reject.isPending}>
            Decline claim
          </Button>
        </form>
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
        <Select name="expenseCategory" required>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
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
      <FormError error={error} fallback="Failed to save expense" />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        Save expense
      </Button>
    </form>
  );
}
