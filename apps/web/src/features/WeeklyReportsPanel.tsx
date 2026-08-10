import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Plus } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { WeeklyReport } from '@/lib/types';
import { fmtDate, isoDate, thumbUrl } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

/** Sunday that ends the current week — the default period a report covers. */
function thisWeekEnding() {
  const d = new Date();
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() + (day === 0 ? 0 : 7 - day));
  return isoDate(d);
}

const FIELDS: { key: keyof WeeklyReport; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'milestones', label: 'Milestones reached' },
  { key: 'issues', label: 'Issues & blockers' },
  { key: 'nextWeekPlan', label: 'Plan for next week' },
];

export function WeeklyReportsPanel({
  projectId,
  canSubmit,
}: {
  projectId: string;
  canSubmit: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: reports } = useQuery({
    queryKey: ['weekly-reports', projectId],
    queryFn: () => api<WeeklyReport[]>(`/projects/${projectId}/weekly-reports`),
  });

  const submit = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/weekly-reports`, { formData }),
    onSuccess: () => {
      toast.success('Weekly report filed.');
      void qc.invalidateQueries({ queryKey: ['weekly-reports', projectId] });
      setOpen(false);
    },
    onError: (e) => toast.error(errText(e, 'The report was not filed.')),
  });

  return (
    <div className="space-y-4">
      {canSubmit && (
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> Submit weekly report
          </Button>
        </div>
      )}

      {reports?.length === 0 && (
        <div className="rounded-xl border border-hairline bg-surface shadow-sm">
          <Empty icon={CalendarRange}>
            <p className="font-medium text-fg">No weekly reports yet</p>
            <p className="mt-1 max-w-xs text-fg-muted">
              A weekly summary keeps the office up to date on overall site progress.
            </p>
          </Empty>
        </div>
      )}

      <div className="space-y-3">
        {reports?.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-fg">Week ending {fmtDate(r.weekEnding)}</p>
              <p className="text-xs text-fg-subtle">{r.submittedBy.name}</p>
            </div>
            <dl className="mt-2 space-y-2 text-sm">
              {FIELDS.map(({ key, label }) =>
                r[key] ? (
                  <div key={key}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                      {label}
                    </dt>
                    <dd className="whitespace-pre-line text-fg">{r[key] as string}</dd>
                  </div>
                ) : null,
              )}
            </dl>
            {r.photoUrls.length > 0 && (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {r.photoUrls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    <img
                      src={thumbUrl(url, 160)}
                      alt="Site progress"
                      loading="lazy"
                      className="h-20 w-20 rounded-lg object-cover"
                    />
                  </a>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Weekly site report">
        <form
          key={String(open)}
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <Field label="Week ending">
            <Input name="weekEnding" type="date" defaultValue={thisWeekEnding()} required />
          </Field>
          <Field label="Summary of the week">
            <Textarea
              name="summary"
              required
              placeholder="Overall, the block A interior finishing progressed well…"
            />
          </Field>
          <Field label="Milestones reached (optional)">
            <Textarea name="milestones" placeholder="Completed tiling on ground floor" />
          </Field>
          <Field label="Issues & blockers (optional)">
            <Textarea name="issues" placeholder="Awaiting paint delivery; short by 2 masons" />
          </Field>
          <Field label="Plan for next week (optional)">
            <Textarea name="nextWeekPlan" placeholder="Start ceiling works, finish exterior plaster" />
          </Field>
          <Field label="Photos (up to 6)">
            <Input name="photos" type="file" accept="image/*" capture="environment" multiple />
          </Field>
          {submit.isError && (
            <p className="text-sm text-danger-fg">
              {submit.error instanceof ApiRequestError ? submit.error.message : 'Failed to submit report'}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={submit.isPending}>
            Submit report
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
