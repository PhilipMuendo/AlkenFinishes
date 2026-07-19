import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import type { Task, TaskStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Empty } from '@/components/ui/table';

const STATUSES: TaskStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'DONE'];

export function TasksPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const { data: tasks } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => api<Task[]>(`/projects/${projectId}/tasks`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['tasks', projectId] });
    void qc.invalidateQueries({ queryKey: ['analytics'] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
  };

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/projects/${projectId}/tasks`, { body }),
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/projects/${projectId}/tasks/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });

  const addPhoto = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const formData = new FormData();
      formData.append('photo', file);
      return api(`/projects/${projectId}/tasks/${id}/photos`, { formData });
    },
    onSuccess: invalidate,
  });

  const phases = [...new Set((tasks ?? []).map((t) => t.phase))];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={16} /> Add task
        </Button>
      </div>

      {tasks?.length === 0 && <Empty>No tasks yet. Break the work into phases and tasks.</Empty>}

      {phases.map((phase) => {
        const phaseTasks = (tasks ?? []).filter((t) => t.phase === phase);
        const avg = Math.round(
          phaseTasks.reduce((s, t) => s + t.completionPct, 0) / phaseTasks.length,
        );
        return (
          <Card key={phase} className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">{phase}</h3>
              <span className="text-xs tabular-nums text-slate-500">{avg}% complete</span>
            </div>
            <div className="space-y-2">
              {phaseTasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setEditing(t)}
                  className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{t.name}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Progress value={t.completionPct} health="GREEN" className="max-w-[160px]" />
                      <span className="text-xs tabular-nums text-slate-500">
                        {t.completionPct}%
                      </span>
                      {t.photos.length > 0 && (
                        <span className="flex items-center gap-1 text-xs text-slate-400">
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
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            create.mutate({ phase: fd.get('phase'), name: fd.get('name') });
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
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              update.mutate({
                id: editing.id,
                body: {
                  status: fd.get('status'),
                  completionPct: Number(fd.get('completionPct')),
                  notes: fd.get('notes') || null,
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
                      src={p.fileUrl}
                      alt={p.caption ?? 'Task photo'}
                      className="h-16 w-16 rounded-lg object-cover"
                    />
                  </a>
                ))}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={update.isPending}>
              Save changes
            </Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}
