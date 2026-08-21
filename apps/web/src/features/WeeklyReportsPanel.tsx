import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ChatStatus, WeeklyReport, WeeklyReportDraft } from '@/lib/types';
import { dayOf, fmtDate, fmtWeekRange, isoDate, thumbUrl, weekEndingOf } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { SkeletonList } from '@/components/ui/skeleton';
import { Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

/** Sunday that ends the current week — the default period a report covers. */
const thisWeekEnding = () => weekEndingOf(isoDate(new Date()));

const FIELDS: { key: keyof WeeklyReport; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'milestones', label: 'Milestones reached' },
  { key: 'issues', label: 'Issues & blockers' },
  { key: 'nextWeekPlan', label: 'Plan for next week' },
];

const MAX_PHOTOS = 6;

/** How long until the drafting quota lets go, in words rather than seconds. */
function retryIn(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 90) return `about ${Math.max(1, Math.round(seconds))} seconds`;
  return `about ${Math.round(seconds / 60)} minutes`;
}

export function WeeklyReportsPanel({
  projectId,
  canSubmit,
}: {
  projectId: string;
  canSubmit: boolean;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPERADMIN';

  const [open, setOpen] = useState(false);
  // Prefills the form below; what gets filed is whatever is showing when
  // Submit is pressed.
  const [draft, setDraft] = useState<WeeklyReportDraft | null>(null);
  const [weekEnding, setWeekEnding] = useState(thisWeekEnding);
  const [showFacts, setShowFacts] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const [deleting, setDeleting] = useState<WeeklyReport | null>(null);

  const { data: ai } = useQuery({
    queryKey: ['chat', 'status'],
    queryFn: () => api<ChatStatus>('/chat/status'),
    staleTime: 60_000,
  });

  const { data: reports, isPending } = useQuery({
    queryKey: ['weekly-reports', projectId],
    queryFn: () => api<WeeklyReport[]>(`/projects/${projectId}/weekly-reports`),
  });

  // Filing for a week that already has a report replaces it. The form has to
  // open on what is already there, or a supervisor fixing one sentence would
  // have to retype the other four fields from memory to keep them.
  const filedForWeek = reports?.find((r) => dayOf(r.weekEnding) === weekEnding) ?? null;
  const canManage = (r: WeeklyReport) => isAdmin || r.submittedBy.id === user?.id;

  const writeDraft = useMutation({
    mutationFn: (week: string) =>
      api<WeeklyReportDraft>(`/projects/${projectId}/weekly-reports/draft`, {
        body: { weekEnding: week },
      }),
    onSuccess: (d) => {
      setDraft(d);
      setShowFacts(false);
    },
  });
  const draftDetails =
    writeDraft.error instanceof ApiRequestError
      ? (writeDraft.error.details as
          | { reason?: string; retryAfterSeconds?: number | null }
          | undefined)
      : undefined;
  const draftFailure = draftDetails?.reason ?? null;
  const draftRetry = retryIn(draftDetails?.retryAfterSeconds);

  /** Everything the dialog accumulates, cleared whenever it changes week or shuts. */
  const clearDraftState = () => {
    setDraft(null);
    setShowFacts(false);
    setPhotoCount(0);
    writeDraft.reset();
  };

  const submit = useMutation({
    mutationFn: (v: { formData: FormData; revising: boolean }) =>
      api(`/projects/${projectId}/weekly-reports`, { formData: v.formData }),
    onSuccess: (_data, v) => {
      toast.success(v.revising ? 'Weekly report updated.' : 'Weekly report filed.');
      void qc.invalidateQueries({ queryKey: ['weekly-reports', projectId] });
      setOpen(false);
      setWeekEnding(thisWeekEnding());
      clearDraftState();
    },
    onError: (e) => toast.error(errText(e, 'The report was not filed.')),
  });

  const closeDialog = () => {
    setOpen(false);
    setWeekEnding(thisWeekEnding());
    clearDraftState();
    submit.reset();
  };

  const openFor = (week: string) => {
    setWeekEnding(week);
    clearDraftState();
    submit.reset();
    setOpen(true);
  };

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/projects/${projectId}/weekly-reports/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Weekly report withdrawn.');
      void qc.invalidateQueries({ queryKey: ['weekly-reports', projectId] });
      setDeleting(null);
    },
  });

  const tooManyPhotos = photoCount > MAX_PHOTOS;
  const currentWeek = thisWeekEnding();

  return (
    <div className="space-y-4">
      {canSubmit && (
        <div className="flex justify-end">
          <Button onClick={() => openFor(currentWeek)}>
            <Plus size={16} /> Submit weekly report
          </Button>
        </div>
      )}

      {isPending && <SkeletonList rows={2} />}

      {reports?.length === 0 && (
        <Empty icon={CalendarRange}>
          <p className="font-medium text-fg">No weekly reports yet</p>
          <p className="mt-1 max-w-xs text-fg-muted">
            A weekly summary keeps the office up to date on overall site progress.
          </p>
        </Empty>
      )}

      <div className="space-y-3">
        {reports?.map((r) => {
          const revised = new Date(r.updatedAt) > new Date(r.createdAt);
          return (
            <Card key={r.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-fg">Week ending {fmtDate(r.weekEnding)}</p>
                    {dayOf(r.weekEnding) === currentWeek && <Badge tone="blue">This week</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    {fmtWeekRange(r.weekEnding)} · {r.submittedBy.name} ·{' '}
                    {revised ? `revised ${fmtDate(r.updatedAt)}` : `filed ${fmtDate(r.createdAt)}`}
                  </p>
                </div>
                {canManage(r) && (
                  <div className="flex shrink-0 gap-1">
                    {canSubmit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Revise this report"
                        title="Revise this report"
                        onClick={() => openFor(dayOf(r.weekEnding))}
                      >
                        <Pencil size={16} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete this report"
                      title="Delete this report"
                      onClick={() => setDeleting(r)}
                    >
                      <Trash2 size={16} className="text-danger-fg" />
                    </Button>
                  </div>
                )}
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
          );
        })}
      </div>

      <Dialog
        open={open}
        onClose={closeDialog}
        title={filedForWeek ? 'Revise weekly report' : 'Weekly site report'}
      >
        <form
          // Remount whenever the week, the draft or the report underneath
          // changes, so the prefilled values below are the ones on screen.
          key={`${weekEnding}-${draft ? 'drafted' : (filedForWeek?.updatedAt ?? 'blank')}`}
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate({
              formData: new FormData(e.currentTarget),
              revising: Boolean(filedForWeek),
            });
          }}
          className="space-y-3"
        >
          <Field label="Week ending" hint={fmtWeekRange(weekEnding)}>
            <Input
              name="weekEnding"
              type="date"
              value={weekEnding}
              onChange={(e) => {
                // Any day the supervisor picks belongs to exactly one week, and
                // that week is what gets filed — so snap here rather than let
                // two people file the same seven days under two dates.
                setWeekEnding(e.target.value ? weekEndingOf(e.target.value) : thisWeekEnding());
                // A draft summarises the week it was written for; changing
                // the week without clearing it would leave last week's
                // summary sitting under this week's date.
                setDraft(null);
                setShowFacts(false);
                writeDraft.reset();
              }}
              required
            />
          </Field>

          {filedForWeek && (
            <p className="rounded-lg bg-warn-surface p-2.5 text-xs text-warn-fg ring-1 ring-inset ring-amber-600/20">
              This week already has a report, filed by {filedForWeek.submittedBy.name} on{' '}
              {fmtDate(filedForWeek.createdAt)}. It is loaded below — saving replaces it, and any
              photos you add are kept alongside the {filedForWeek.photoUrls.length} already there.
            </p>
          )}

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
                  disabled={
                    writeDraft.isPending || submit.isPending || draftFailure === 'QUOTA_DAILY'
                  }
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
                    : 'Could not write a draft. Fill it in by hand.'}{' '}
                  {draftRetry
                    ? `Try again in ${draftRetry}.`
                    : draftFailure === 'QUOTA_DAILY'
                      ? 'It resets tomorrow.'
                      : ''}
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
              defaultValue={draft?.draft.summary ?? filedForWeek?.summary ?? ''}
            />
          </Field>
          <Field label="Milestones reached (optional)">
            <Textarea
              name="milestones"
              placeholder="Completed tiling on ground floor"
              defaultValue={draft?.draft.milestones ?? filedForWeek?.milestones ?? ''}
            />
          </Field>
          <Field label="Issues & blockers (optional)">
            <Textarea
              name="issues"
              placeholder="Awaiting paint delivery; short by 2 masons"
              defaultValue={draft?.draft.issues ?? filedForWeek?.issues ?? ''}
            />
          </Field>
          <Field label="Plan for next week (optional)">
            <Textarea
              name="nextWeekPlan"
              placeholder="Start ceiling works, finish exterior plaster"
              defaultValue={draft?.draft.nextWeekPlan ?? filedForWeek?.nextWeekPlan ?? ''}
            />
          </Field>
          <Field
            label={`Photos (up to ${MAX_PHOTOS})`}
            hint={photoCount > 0 ? `${photoCount} selected` : undefined}
          >
            <Input
              name="photos"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setPhotoCount(e.target.files?.length ?? 0)}
            />
          </Field>
          {tooManyPhotos && (
            <p className="text-sm text-danger-fg">
              Only {MAX_PHOTOS} photos can go on one report — {photoCount} are selected. Choose
              fewer, or file the rest in the site&rsquo;s photo gallery.
            </p>
          )}
          {submit.isError && (
            <p className="text-sm text-danger-fg">
              {submit.error instanceof ApiRequestError
                ? submit.error.message
                : 'Failed to submit report'}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={submit.isPending || tooManyPhotos}
          >
            {filedForWeek ? 'Save changes' : 'Submit report'}
          </Button>
        </form>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => {
          setDeleting(null);
          remove.reset();
        }}
        title="Delete this weekly report?"
        description={
          deleting
            ? `The summary for the week ending ${fmtDate(deleting.weekEnding)}${
                deleting.photoUrls.length ? ` and its ${deleting.photoUrls.length} photos` : ''
              } will be removed. The daily reports it was written from are not affected.`
            : undefined
        }
        pending={remove.isPending}
        error={remove.isError ? errText(remove.error, 'The report was not deleted.') : null}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
