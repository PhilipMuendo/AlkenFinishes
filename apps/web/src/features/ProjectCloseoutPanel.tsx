import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Lock, XCircle } from 'lucide-react';
import { api, errText } from '@/lib/api';
import type { CloseoutItem, ProjectCloseout } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/input';
import { QueryState } from '@/components/ui/query-state';
import { toast } from '@/components/ui/toast';

const AUTO_LABELS = new Set(['Quality approved', 'Snags closed', 'Site handed over', 'Final invoice issued', 'Payments reconciled']);

/**
 * The final gate. Five of the thirteen items are worked out automatically
 * from Quality Inspection, the Snag list, Handover and Invoices — the rest
 * are ticked by hand. "Close project" stays disabled until every one of the
 * thirteen is checked.
 */
export function ProjectCloseoutPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['project-closeout', projectId],
    queryFn: () => api<ProjectCloseout>(`/projects/${projectId}/closeout`),
  });
  const { data } = query;

  const [manualItems, setManualItems] = useState<CloseoutItem[]>([]);
  const [lessonsLearned, setLessonsLearned] = useState('');

  useEffect(() => {
    if (data) {
      setManualItems(data.manualItems);
      setLessonsLearned(data.lessonsLearned ?? '');
    }
  }, [data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['project-closeout', projectId] });

  const save = useMutation({
    mutationFn: (body: { items: CloseoutItem[]; lessonsLearned: string | null }) =>
      api<ProjectCloseout>(`/projects/${projectId}/closeout`, { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('Close-out checklist saved.');
      invalidate();
    },
    onError: (e) => toast.error(errText(e, 'The checklist was not saved.')),
  });

  const close = useMutation({
    mutationFn: () => api<ProjectCloseout>(`/projects/${projectId}/closeout/close`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Project closed.');
      invalidate();
      void qc.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (e) => toast.error(errText(e, 'The project could not be closed.')),
  });

  if (!data) return <QueryState query={query} rows={5} noun="the close-out checklist" />;

  const closed = !!data.closedAt;

  return (
    <div className="space-y-4">
      {closed && (
        <p className="flex items-center gap-1.5 rounded-lg bg-good-surface p-2.5 text-xs text-good-fg ring-1 ring-inset ring-good-hairline">
          <Lock size={14} /> Closed by {data.closedBy?.name} on {fmtDate(data.closedAt!)}.
        </p>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">Close-out checklist</CardTitle>
          <p className="text-xs text-fg-muted">
            Quality approved, snags closed, site handed over, final invoice issued and payments
            reconciled are worked out automatically from the rest of the project's own records.
          </p>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {data.items.map((item) => {
            const auto = AUTO_LABELS.has(item.label);
            const manualIndex = manualItems.findIndex((m) => m.label === item.label);
            const checked = auto ? item.checked : (manualItems[manualIndex]?.checked ?? false);
            return (
              <label
                key={item.label}
                className={`flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2 ${
                  auto || closed ? '' : 'cursor-pointer'
                }`}
              >
                <span className="text-sm text-fg">{item.label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {auto && <span className="text-xs text-fg-subtle">Auto</span>}
                  {checked ? (
                    <CheckCircle2 size={18} className="text-good-fg" />
                  ) : (
                    <XCircle size={18} className="text-fg-subtle" />
                  )}
                  {!auto && !closed && (
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={checked}
                      onChange={(e) =>
                        setManualItems((prev) =>
                          prev.map((m, i) => (i === manualIndex ? { ...m, checked: e.target.checked } : m)),
                        )
                      }
                    />
                  )}
                </span>
              </label>
            );
          })}
        </CardContent>
      </Card>

      {!closed && (
        <>
          <Field label="Lessons learned">
            <Textarea
              value={lessonsLearned}
              onChange={(e) => setLessonsLearned(e.target.value)}
              placeholder="What would we do differently next time?"
            />
          </Field>

          {save.isError && <p className="text-sm text-danger-fg">{errText(save.error, 'Failed to save')}</p>}
          <Button
            variant="outline"
            className="w-full"
            disabled={save.isPending}
            onClick={() => save.mutate({ items: manualItems, lessonsLearned: lessonsLearned || null })}
          >
            Save checklist
          </Button>

          {close.isError && <p className="text-sm text-danger-fg">{errText(close.error, 'Failed to close')}</p>}
          <Button className="w-full" disabled={!data.complete || close.isPending} onClick={() => close.mutate()}>
            <Lock size={16} /> Close project
          </Button>
        </>
      )}
    </div>
  );
}
