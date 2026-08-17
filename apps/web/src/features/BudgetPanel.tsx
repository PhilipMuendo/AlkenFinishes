import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { BudgetCategory } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormError } from '@/components/ui/form-error';
import { Field, Input } from '@/components/ui/input';
import { QueryState } from '@/components/ui/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

const CATEGORIES: BudgetCategory[] = ['MATERIALS', 'LABOUR', 'TRANSPORT', 'OTHER'];

interface BudgetLine {
  category: BudgetCategory;
  allocated: string;
}

export function BudgetPanel({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: queryKeys.budget.byProject(projectId),
    queryFn: () => api<BudgetLine[]>(`/projects/${projectId}/budget`),
  });

  return (
    <QueryState
      query={query}
      errorTitle="Couldn’t load the budget"
      skeleton={<Skeleton className="h-96 max-w-xl rounded-xl" />}
    >
      {/* Keyed on the project so switching sites reseeds the form. The seed
          happens in `useState`, not an effect, so editing a field is never
          undone by a background refetch. */}
      {(lines) => <BudgetForm key={projectId} projectId={projectId} lines={lines} />}
    </QueryState>
  );
}

function BudgetForm({ projectId, lines }: { projectId: string; lines: BudgetLine[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      CATEGORIES.map((cat) => [
        cat,
        String(Number(lines.find((l) => l.category === cat)?.allocated ?? 0)),
      ]),
    ),
  );

  const save = useMutation({
    mutationFn: () =>
      api(`/projects/${projectId}/budget`, {
        method: 'PUT',
        body: {
          lines: CATEGORIES.map((category) => ({
            category,
            allocated: Number(values[category] ?? 0),
          })),
        },
      }),
    onSuccess: () => {
      toast.success('Budget saved');
      void qc.invalidateQueries({ queryKey: queryKeys.budget.byProject(projectId) });
      void qc.invalidateQueries({ queryKey: queryKeys.analytics.project(projectId) });
      void qc.invalidateQueries({ queryKey: queryKeys.analytics.company() });
    },
  });

  const total = CATEGORIES.reduce((s, c) => s + Number(values[c] ?? 0), 0);

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Project budget allocation (KES)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {CATEGORIES.map((cat) => (
          <Field key={cat} label={cat.charAt(0) + cat.slice(1).toLowerCase()}>
            <Input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={values[cat] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [cat]: e.target.value }))}
            />
          </Field>
        ))}
        <p className="text-sm text-fg-muted">
          Total budget:{' '}
          <span className="nums font-semibold">KES {total.toLocaleString('en-KE')}</span>
        </p>
        <FormError error={save.error} fallback="Failed to save budget" />
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Save budget
        </Button>
      </CardContent>
    </Card>
  );
}
