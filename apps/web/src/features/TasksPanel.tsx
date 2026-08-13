import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Camera, Plus } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { thumbUrl } from '@/lib/format';
import type { Task, TaskStatus, TasksResponse } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

const STATUSES: TaskStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'DONE'];

export function TasksPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  // Weight is the task's share of the contract value, priced from the
  // schedule — the office's figure, same as a pay rate or a budget line.
  // The server now ignores it from a non-office request regardless; this
  // just keeps the field from being offered in the first place.
  const isAdmin = user?.role === 'SUPERADMIN';
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);

  const { data } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => api<TasksResponse>(`/projects/${projectId}/tasks`),
  });
  const tasks = data?.tasks;
  const progress = data?.progress;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['tasks', projectId] });
    void qc.invalidateQueries({ queryKey: ['analytics', 'project', projectId] });
    void qc.invalidateQueries({ queryKey: ['analytics', 'company'] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
  };

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/projects/${projectId}/tasks`, { body }),
    onSuccess: () => {
      toast.success('Task added to the programme.');
      invalidate();
      setAddOpen(false);
    },
    onError: (e) => toast.error(errText(e, 'The task was not added.')),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/projects/${projectId}/tasks/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      toast.success('Task updated.');
      invalidate();
      setEditing(null);
    },
    onError: (e) => toast.error(errText(e, 'The changes were not saved.')),
  });

  const addPhoto = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const formData = new FormData();
      formData.append('photo', file);
      return api(`/projects/${projectId}/tasks/${id}/photos`, { formData });
    },
    onSuccess: () => {
      toast.success('Photo attached to the task.');
      invalidate();
    },
    onError: (e) => toast.error(errText(e, 'The photo was not attached.')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Task deleted.');
      invalidate();
      setEditing(null);
      setDeleting(null);
    },
    onError: (e) => toast.error(errText(e, 'The task was not deleted.')),
  });

  const phases = [...new Set((tasks ?? []).map((t) => t.phase))];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        {progress && progress.taskCount > 0 ? (
          <p className="text-sm text-fg-muted">
            <span className="font-semibold tabular-nums text-fg">{progress.pct}% complete</span>
            {progress.weighted ? (
              <> · weighted by task size</>
            ) : (
              <> · every task counted equally</>
            )}
          </p>
        ) : (
          <span />
        )}
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={16} /> Add task
        </Button>
      </div>

      {/* A part-finished weighting job is worse than none: a task left on the
          default weight of 1 is invisible beside tasks priced in hundreds of
          thousands, and the headline figure silently ignores it. */}
      {progress && progress.unweightedTaskCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warn-hairline bg-warn-surface p-3 text-sm text-warn-fg">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>
            {progress.unweightedTaskCount} of {progress.taskCount} tasks still have no size set, so
            they barely move the figure above. Give every task a size — or none of them — for it to
            mean anything.
          </p>
        </div>
      )}

      {progress?.weighted && progress.pct !== progress.unweightedPct && (
        <p className="text-xs text-fg-subtle">
          Counting every task equally would have said {progress.unweightedPct}%.
        </p>
      )}

      {tasks?.length === 0 && <Empty>No tasks yet. Break the work into phases and tasks.</Empty>}

      {phases.map((phase) => {
        const phaseTasks = (tasks ?? []).filter((t) => t.phase === phase);
        // Same rule as the project figure: a phase is as done as its weight is.
        const phaseWeight = phaseTasks.reduce((s, t) => s + (t.weight > 0 ? t.weight : 0), 0);
        const avg =
          phaseWeight > 0
            ? Math.round(
                phaseTasks.reduce((s, t) => s + t.completionPct * (t.weight > 0 ? t.weight : 0), 0) /
                  phaseWeight,
              )
            : Math.round(phaseTasks.reduce((s, t) => s + t.completionPct, 0) / phaseTasks.length);
        return (
          <Card key={phase} className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-fg">{phase}</h3>
              <span className="text-xs tabular-nums text-fg-muted">{avg}% complete</span>
            </div>
            <div className="space-y-2">
              {phaseTasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setEditing(t)}
                  className="flex w-full items-center gap-3 rounded-lg border border-hairline p-3 text-left hover:bg-surface-sunken"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{t.name}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Progress value={t.completionPct} health="GREEN" className="max-w-[160px]" />
                      <span className="text-xs tabular-nums text-fg-muted">
                        {t.completionPct}%
                      </span>
                      {t.weight !== 1 && (
                        <span className="text-xs tabular-nums text-fg-subtle">
                          size {t.weight.toLocaleString()}
                        </span>
                      )}
                      {t.photos.length > 0 && (
                        <span className="flex items-center gap-1 text-xs text-fg-subtle">
                          <Camera size={12} /> {t.photos.length}
                        </span>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={t.status} />
                </button>
              ))}
            </div>
          </Card>
        );
      })}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add task">
        <form
          key={String(addOpen)}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const weight = fd.get('weight');
            create.mutate({
              phase: fd.get('phase'),
              name: fd.get('name'),
              ...(weight ? { weight: Number(weight) } : {}),
            });
          }}
          className="space-y-3"
        >
          <Field label="Phase">
            <Input name="phase" list="phases" required placeholder="Painting" />
            <datalist id="phases">
              {phases.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>
          <Field label="Task name">
            <Input name="name" required placeholder="First coat" />
          </Field>
          {isAdmin && (
            <Field
              label="Size (optional)"
              hint="What this task is worth from the priced schedule. Any consistent unit works — only the ratios matter. Leave blank to count it the same as every other task."
            >
              <Input
                name="weight"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder="e.g. 250000"
              />
            </Field>
          )}
          <Button type="submit" className="w-full" disabled={create.isPending}>
            Add task
          </Button>
        </form>
      </Dialog>

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `${editing.phase} — ${editing.name}` : ''}
      >
        {editing && (
          <form
            key={editing.id}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const weight = fd.get('weight');
              update.mutate({
                id: editing.id,
                body: {
                  status: fd.get('status'),
                  completionPct: Number(fd.get('completionPct')),
                  notes: fd.get('notes') || null,
                  ...(weight ? { weight: Number(weight) } : {}),
                },
              });
            }}
            className="space-y-3"
          >
            <Field label="Status">
              <Select name="status" defaultValue={editing.status}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Completion %">
              <Input
                name="completionPct"
                type="number"
                min="0"
                max="100"
                inputMode="numeric"
                defaultValue={editing.completionPct}
              />
            </Field>
            {isAdmin && (
              <Field
                label="Size"
                hint="What this task is worth relative to the others — its amount from the priced schedule is the usual choice. 1 means it has not been sized."
              >
                <Input
                  name="weight"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  defaultValue={editing.weight}
                />
              </Field>
            )}
            <Field label="Notes">
              <Textarea name="notes" defaultValue={editing.notes ?? ''} />
            </Field>
            <Field label="Add photo">
              <Input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) addPhoto.mutate({ id: editing.id, file });
                }}
              />
            </Field>
            {editing.photos.length > 0 && (
              <div className="flex gap-2 overflow-x-auto">
                {editing.photos.map((p) => (
                  <a key={p.id} href={p.fileUrl} target="_blank" rel="noreferrer">
                    <img
                      src={thumbUrl(p.fileUrl, 160)}
                      alt={p.caption ?? 'Task photo'}
                      loading="lazy"
                      className="h-16 w-16 rounded-lg object-cover"
                    />
                  </a>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              {isAdmin && (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.reset();
                    setDeleting(editing);
                  }}
                >
                  Delete
                </Button>
              )}
              <Button type="submit" className="flex-1" disabled={update.isPending}>
                Save changes
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete "${deleting.name}"?` : ''}
        description="This removes the task and its photos from the programme. It cannot be undone."
        pending={remove.isPending}
        error={remove.error instanceof ApiRequestError ? remove.error.message : null}
        onConfirm={() => remove.mutate(deleting!.id)}
      />
    </div>
  );
}
