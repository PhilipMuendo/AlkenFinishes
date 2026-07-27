import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import type { DailyReport } from '@/lib/types';
import { fmtDate, thumbUrl, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Empty } from '@/components/ui/table';

export function ReportsPanel({ projectId, canSubmit }: { projectId: string; canSubmit: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: reports } = useQuery({
    queryKey: ['daily-reports', projectId],
    queryFn: () => api<DailyReport[]>(`/projects/${projectId}/daily-reports`),
  });

  const submit = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/daily-reports`, { formData }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['daily-reports', projectId] });
      setOpen(false);
    },
  });

  return (
    <div className="space-y-4">
      {canSubmit && (
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> Submit daily report
          </Button>
        </div>
      )}

      {reports?.length === 0 && (
        <Empty icon={ClipboardList}>No daily reports submitted yet</Empty>
      )}

      <div className="space-y-3">
        {reports?.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-fg">{fmtDate(r.date)}</p>
              <p className="text-xs text-fg-muted">
                {r.submittedBy.name} · {r.workersPresent} workers present
              </p>
            </div>
            <dl className="mt-2 space-y-2 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase text-fg-subtle">Work completed</dt>
                <dd className="text-fg">{r.workCompleted}</dd>
              </div>
              {r.materialsUsed && (
                <div>
                  <dt className="text-xs font-medium uppercase text-fg-subtle">Materials used</dt>
                  <dd className="text-fg">{r.materialsUsed}</dd>
                </div>
              )}
              {r.challenges && (
                <div>
                  <dt className="text-xs font-medium uppercase text-fg-subtle">Challenges</dt>
                  <dd className="text-fg">{r.challenges}</dd>
                </div>
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

      <Dialog open={open} onClose={() => setOpen(false)} title="Daily site report">
        <form
          key={String(open)}
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <Field label="Date">
            <Input name="date" type="date" defaultValue={todayISO()} required />
          </Field>
          <Field label="Work completed today">
            <Textarea name="workCompleted" required placeholder="Finished first coat in living room…" />
          </Field>
          <Field label="Workers present">
            <Input name="workersPresent" type="number" min="0" inputMode="numeric" required />
          </Field>
          <Field label="Materials used (optional)">
            <Textarea name="materialsUsed" placeholder="10 bags cement, 20L paint" />
          </Field>
          <Field label="Challenges (optional)">
            <Textarea name="challenges" placeholder="Rain delayed exterior work" />
          </Field>
          <Field label="Photos (up to 6)">
            <Input name="photos" type="file" accept="image/*" capture="environment" multiple />
          </Field>
          {submit.isError && (
            <p className="text-sm text-red-600">
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
