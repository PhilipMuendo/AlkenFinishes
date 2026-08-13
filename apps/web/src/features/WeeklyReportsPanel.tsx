import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Plus, Sparkles } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { ChatStatus, WeeklyReport, WeeklyReportDraft } from '@/lib/types';
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
  // Prefills the form below; what gets filed is whatever is showing when
  // Submit is pressed.
  const [draft, setDraft] = useState<WeeklyReportDraft | null>(null);
  const [weekEnding, setWeekEnding] = useState(thisWeekEnding());
  const [showFacts, setShowFacts] = useState(false);

  const { data: ai } = useQuery({
    queryKey: ['chat', 'status'],
    queryFn: () => api<ChatStatus>('/chat/status'),
    staleTime: 60_000,
  });

  const writeDraft = useMutation({
    mutationFn: (weekEnding: string) =>
      api<WeeklyReportDraft>(`/projects/${projectId}/weekly-reports/draft`, { body: { weekEnding } }),
    onSuccess: setDraft,
  });
  const draftFailure =
    writeDraft.error instanceof ApiRequestError
      ? ((writeDraft.error.details as { reason?: string } | undefined)?.reason ?? null)
      : null;

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

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setDraft(null);
          writeDraft.reset();
        }}
        title="Weekly site report"
      >
        <form
          key={`${String(open)}-${draft ? 'drafted' : 'blank'}`}
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <Field label="Week ending">
            <Input
              name="weekEnding"
              type="date"
              value={weekEnding}
              onChange={(e) => {
                setWeekEnding(e.target.value);
                // A draft summarises the week it was written for; changing
                // the week without clearing it would leave last week's
                // summary sitting under this week's date.
                if (draft) {
                  setDraft(null);
                  writeDraft.reset();
                }
              }}
              required
            />
          </Field>

          {/* Drafts from the week's own daily reports — the point is to save
              re-typing seven diary entries into one summary by hand. */}
          {ai?.available && (
            <div className="rounded-lg border border-dashed border-hairline-strong p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">Write it up for me</p>
                  <p className="text-xs text-fg-muted">
                    From this week&rsquo;s daily reports. You edit it before it is filed.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={writeDraft.isPending || draftFailure === 'QUOTA_DAILY'}
                  onClick={() => writeDraft.mutate(weekEnding)}
                >
                  <Sparkles size={15} />
                  {writeDraft.isPending ? 'Writing…' : draft ? 'Rewrite' : 'Draft summary'}
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
                    Drafted from {draft.daysReported} of 7 daily reports —{' '}
                    <span className="font-medium text-fg">read it before filing</span>. Correct
                    anything that is not right.
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

          <Field label="Summary of the week">
            <Textarea
              name="summary"
              required
              placeholder="Overall, the block A interior finishing progressed well…"
              defaultValue={draft?.draft.summary ?? ''}
            />
          </Field>
          <Field label="Milestones reached (optional)">
            <Textarea
              name="milestones"
              placeholder="Completed tiling on ground floor"
              defaultValue={draft?.draft.milestones ?? ''}
            />
          </Field>
          <Field label="Issues & blockers (optional)">
            <Textarea
              name="issues"
              placeholder="Awaiting paint delivery; short by 2 masons"
              defaultValue={draft?.draft.issues ?? ''}
            />
          </Field>
          <Field label="Plan for next week (optional)">
            <Textarea
              name="nextWeekPlan"
              placeholder="Start ceiling works, finish exterior plaster"
              defaultValue={draft?.draft.nextWeekPlan ?? ''}
            />
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
