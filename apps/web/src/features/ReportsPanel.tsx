import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { DailyReport } from '@/lib/types';
import { fmtDate, thumbUrl, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Empty } from '@/components/ui/table';

type DiaryTextField =
  | 'weather'
  | 'visitors'
  | 'materialsDelivered'
  | 'instructionsGiven'
  | 'delays'
  | 'safetyNotes'
  | 'equipmentOnSite';

const DIARY_FIELDS: [DiaryTextField, string][] = [
  ['weather', 'Weather'],
  ['visitors', 'Visitors'],
  ['materialsDelivered', 'Materials delivered'],
  ['instructionsGiven', 'Instructions given'],
  ['delays', 'Delays'],
  ['safetyNotes', 'Safety'],
  ['equipmentOnSite', 'Equipment on site'],
];

export function ReportsPanel({ projectId, canSubmit }: { projectId: string; canSubmit: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: reports } = useQuery({
    queryKey: queryKeys.dailyReports.byProject(projectId),
    queryFn: () => api<DailyReport[]>(`/projects/${projectId}/daily-reports`),
  });

  const submit = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/daily-reports`, { formData }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.dailyReports.byProject(projectId) });
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
              {DIARY_FIELDS.filter(([key]) => r[key]).map(([key, label]) => (
                <div key={key}>
                  <dt className="text-xs font-medium uppercase text-fg-subtle">{label}</dt>
                  <dd className="text-fg">{r[key]}</dd>
                </div>
              ))}
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

          <details className="rounded-lg border border-hairline p-3">
            <summary className="cursor-pointer text-sm font-medium text-fg-muted">
              More detail (optional)
            </summary>
            <div className="mt-3 space-y-3">
              <Field label="Weather">
                <Input name="weather" placeholder="Sunny, light rain in the afternoon" />
              </Field>
              <Field label="Visitors">
                <Textarea name="visitors" rows={2} placeholder="Client visited at 2pm" />
              </Field>
              <Field label="Materials delivered">
                <Textarea name="materialsDelivered" rows={2} placeholder="50 bags cement, delivered 9am" />
              </Field>
              <Field label="Instructions given">
                <Textarea name="instructionsGiven" rows={2} />
              </Field>
              <Field label="Delays">
                <Textarea name="delays" rows={2} />
              </Field>
              <Field label="Safety notes">
                <Textarea name="safetyNotes" rows={2} />
              </Field>
              <Field label="Equipment on site">
                <Textarea name="equipmentOnSite" rows={2} placeholder="Mixer, scaffolding" />
              </Field>
            </div>
          </details>

          <Field label="Photos (up to 6)">
            <Input name="photos" type="file" accept="image/*" capture="environment" multiple />
          </Field>
          <FormError error={submit.error} fallback="Failed to submit report" />
          <Button type="submit" size="lg" className="w-full" disabled={submit.isPending}>
            Submit report
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
