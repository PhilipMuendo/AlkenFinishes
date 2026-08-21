import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus, Sparkles } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { ChatStatus, DailyReport, DailyReportDraft } from '@/lib/types';
import { fmtDate, thumbUrl, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { QueryState } from '@/components/ui/query-state';
import { Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

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
  // A draft written from the day's own records. It only ever prefills the
  // fields below; what gets filed is whatever is showing when Submit is
  // pressed.
  const [draft, setDraft] = useState<DailyReportDraft | null>(null);
  const [draftDate, setDraftDate] = useState(todayISO());
  const [showFacts, setShowFacts] = useState(false);

  // Is a model configured on this server? One key powers all three AI
  // features, so this endpoint answers for drafting as much as for the
  // assistant. Without it the block below is absent rather than disabled — a
  // control that cannot work is worse than no control, which is how the
  // receipt scanner and the assistant already behave.
  const { data: ai } = useQuery({
    queryKey: ['chat', 'status'],
    queryFn: () => api<ChatStatus>('/chat/status'),
    staleTime: 60_000,
  });

  const writeDraft = useMutation({
    mutationFn: (date: string) =>
      api<DailyReportDraft>(`/projects/${projectId}/daily-reports/draft`, { body: { date } }),
    onSuccess: setDraft,
  });
  const draftFailure =
    writeDraft.error instanceof ApiRequestError
      ? ((writeDraft.error.details as { reason?: string } | undefined)?.reason ?? null)
      : null;

  const reportsQuery = useQuery({
    queryKey: ['daily-reports', projectId],
    queryFn: () => api<DailyReport[]>(`/projects/${projectId}/daily-reports`),
  });
  const { data: reports } = reportsQuery;

  const submit = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/daily-reports`, { formData }),
    onSuccess: () => {
      toast.success('Daily report filed.');
      void qc.invalidateQueries({ queryKey: ['daily-reports', projectId] });
      setOpen(false);
    },
    onError: (e) => toast.error(errText(e, 'The report was not filed.')),
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

      <QueryState query={reportsQuery} rows={3} noun="daily reports" />

      {reports?.length === 0 && (
        <Empty icon={ClipboardList}>No daily reports submitted yet</Empty>
      )}

      <div className="space-y-3">
        {reports?.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-fg">{fmtDate(r.date)}</p>
              <p className="text-xs text-fg-muted">
                {r.submittedBy.name} · {r.workersPresent} fundis present
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

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setDraft(null);
          writeDraft.reset();
        }}
        title="Daily site report"
      >
        <form
          key={`${String(open)}-${draft ? 'drafted' : 'blank'}`}
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <Field label="Date">
            <Input
              name="date"
              type="date"
              value={draftDate}
              onChange={(e) => {
                setDraftDate(e.target.value);
                // A draft is a record of what happened on the date it was
                // written for. Changing the date without clearing it would
                // leave yesterday's facts sitting under today's date, filed
                // as if they were the same day.
                if (draft) {
                  setDraft(null);
                  writeDraft.reset();
                }
              }}
              required
            />
          </Field>

          {/* Everything below the date is already known to the system on most
              days. Offering to write it up is the difference between a diary
              that gets filled in and one that does not. */}
          {ai?.available && (
          <div className="rounded-lg border border-dashed border-hairline-strong p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">Write it up for me</p>
                <p className="text-xs text-fg-muted">
                  From today&rsquo;s attendance, tasks, deliveries and snags. You edit it before it
                  is filed.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={writeDraft.isPending || draftFailure === 'QUOTA_DAILY'}
                onClick={() => writeDraft.mutate(draftDate)}
              >
                <Sparkles size={15} />
                {writeDraft.isPending ? 'Writing…' : draft ? 'Rewrite' : 'Draft report'}
              </Button>
            </div>

            {writeDraft.isError && (
              <p
                className={`mt-2 text-sm ${
                  draftFailure === 'QUOTA_DAILY' ? 'text-warn-fg' : 'text-danger-fg'
                }`}
              >
                {writeDraft.error instanceof ApiRequestError
                  ? writeDraft.error.message
                  : 'Could not write a draft. Fill it in by hand.'}
              </p>
            )}

            {draft && (
              <div className="mt-2 border-t border-hairline pt-2">
                <p className="text-xs text-fg-muted">
                  Drafted below — <span className="font-medium text-fg">read it before filing</span>
                  . It is a record of what you saw, so correct anything that is not right.
                </p>
                <button
                  type="button"
                  onClick={() => setShowFacts((v) => !v)}
                  className="mt-1 text-xs font-medium text-brand-700 hover:underline"
                >
                  {showFacts ? 'Hide' : 'Show'} what it was based on
                </button>
                {showFacts && (
                  <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface-muted p-2 text-xs text-fg-muted">
                    {draft.facts}
                  </pre>
                )}
              </div>
            )}
          </div>
          )}

          <Field label="Work completed today">
            <Textarea
              name="workCompleted"
              required
              placeholder="Finished first coat in living room…"
              defaultValue={draft?.draft.workCompleted ?? ''}
            />
          </Field>
          <Field label="Fundis present" hint={draft ? 'Counted from attendance' : undefined}>
            <Input
              name="workersPresent"
              type="number"
              min="0"
              inputMode="numeric"
              required
              defaultValue={draft ? String(draft.workersPresent) : ''}
            />
          </Field>
          <Field label="Materials used (optional)">
            <Textarea
              name="materialsUsed"
              placeholder="10 bags cement, 20L paint"
              defaultValue={draft?.draft.materialsUsed ?? ''}
            />
          </Field>
          <Field label="Challenges (optional)">
            <Textarea
              name="challenges"
              placeholder="Rain delayed exterior work"
              defaultValue={draft?.draft.challenges ?? ''}
            />
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
                <Textarea name="safetyNotes" rows={2} defaultValue={draft?.draft.safetyNotes ?? ''} />
              </Field>
              <Field label="Equipment on site">
                <Textarea name="equipmentOnSite" rows={2} placeholder="Mixer, scaffolding" />
              </Field>
            </div>
          </details>

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
