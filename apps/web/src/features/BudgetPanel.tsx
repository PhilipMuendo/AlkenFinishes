import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { BudgetCategory } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';

const CATEGORIES: BudgetCategory[] = ['MATERIALS', 'LABOUR', 'TRANSPORT', 'OTHER'];

interface BudgetLine {
  category: BudgetCategory;
  allocated: string;
}

export function BudgetPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['budget', projectId],
    queryFn: () => api<BudgetLine[]>(`/projects/${projectId}/budget`),
  });
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) {
      const next: Record<string, string> = {};
      for (const cat of CATEGORIES) {
        next[cat] = String(Number(data.find((l) => l.category === cat)?.allocated ?? 0));
      }
      setValues(next);
    }
  }, [data]);

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
      toast.success('Budget saved. Spend is measured against it from now on.');
      void qc.invalidateQueries({ queryKey: ['budget', projectId] });
      void qc.invalidateQueries({ queryKey: ['analytics', 'project', projectId] });
      void qc.invalidateQueries({ queryKey: ['analytics', 'company'] });
    },
    onError: (e) => toast.error(errText(e, 'The budget was not saved.')),
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
          <span className="font-semibold tabular-nums">
            KES {total.toLocaleString('en-KE')}
          </span>
        </p>
        {save.isSuccess && <p className="text-sm text-good-fg">Budget saved</p>}
        {save.isError && (
          <p className="text-sm text-danger-fg">
            {save.error instanceof ApiRequestError ? save.error.message : 'Failed to save budget'}
          </p>
        )}
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Save budget
        </Button>
      </CardContent>
    </Card>
  );
}
