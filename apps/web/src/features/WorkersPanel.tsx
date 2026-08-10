import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HardHat, Pencil, Plus, UserMinus } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { Worker } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

/**
 * Supervisor-facing fundi roster for a single site: add a casual worker,
 * edit their contact details, or take them off this site. No hourly-rate
 * visibility restriction — the site rate is something a supervisor agrees
 * with the fundi directly, unlike project-level budget/financials.
 */
export function WorkersPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Worker | null>(null);

  const { data: allWorkers } = useQuery({
    queryKey: ['workers'],
    queryFn: () => api<Worker[]>('/workers'),
  });
  // GET /workers returns fundis across every site this supervisor covers;
  // narrow to the one being viewed right now.
  const workers = allWorkers?.filter((w) =>
    w.assignments.some((a) => a.project.id === projectId),
  );

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['workers'] });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/workers', { body: { ...body, projectId } }),
    onSuccess: () => {
      toast.success('Fundi added to this site.');
      invalidate();
      setAddOpen(false);
    },
    onError: (e) => toast.error(errText(e, 'The fundi was not added.')),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/workers/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      toast.success('Fundi updated.');
      invalidate();
      setEditing(null);
    },
    onError: (e) => toast.error(errText(e, 'The changes were not saved.')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/workers/${id}/unassign`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Fundi removed from this site. Their record and history are kept.');
      invalidate();
    },
    onError: (e) => toast.error(errText(e, 'The fundi was not removed.')),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={16} /> Add fundi
        </Button>
      </div>

      {workers?.length === 0 && (
        <div className="rounded-xl border border-hairline bg-surface shadow-sm">
          <Empty icon={HardHat}>
            <p className="font-medium text-fg">No fundis on this site yet</p>
            <p className="mt-1 max-w-xs text-fg-muted">
              Add a casual worker to start tracking their attendance and hours here.
            </p>
          </Empty>
        </div>
      )}

      <div className="space-y-2">
        {workers?.map((w) => (
          <Card key={w.id} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate font-semibold text-fg">{w.name}</p>
              <p className="truncate text-xs text-fg-muted">
                {w.trade} · {w.phone || 'No phone'} ·{' '}
                <span className="nums">KES {Number(w.hourlyRate).toLocaleString()}/hr</span>
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                onClick={() => setEditing(w)}
                aria-label={`Edit ${w.name}`}
                className="rounded-lg p-2 text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg"
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={() => remove.mutate(w.id)}
                aria-label={`Remove ${w.name} from this site`}
                disabled={remove.isPending}
                className="rounded-lg p-2 text-fg-subtle transition-colors hover:bg-danger-surface hover:text-danger-fg"
              >
                <UserMinus size={16} />
              </button>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add fundi">
        <form
          key={String(addOpen)}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            create.mutate({
              name: fd.get('name'),
              phone: fd.get('phone') || null,
              trade: fd.get('trade'),
              hourlyRate: Number(fd.get('hourlyRate')),
            });
          }}
          className="space-y-3"
        >
          <Field label="Full name">
            <Input name="name" required placeholder="John Mwangi" />
          </Field>
          <Field label="Phone">
            <Input name="phone" type="tel" placeholder="0712345678" />
          </Field>
          <Field label="Trade">
            <Input name="trade" required placeholder="Painter, Tiler, Mason…" />
          </Field>
          <Field label="Agreed hourly rate (KES)">
            <Input name="hourlyRate" type="number" min="0" max="5000" step="0.01" required />
          </Field>
          {create.isError && (
            <p className="text-sm text-danger-fg">
              {create.error instanceof ApiRequestError ? create.error.message : 'Failed to add this fundi'}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={create.isPending}>
            Add to this site
          </Button>
        </form>
      </Dialog>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.name}` : ''}>
        {editing && (
          <form
            key={editing.id}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              update.mutate({
                id: editing.id,
                body: {
                  name: fd.get('name'),
                  phone: fd.get('phone') || null,
                  trade: fd.get('trade'),
                  hourlyRate: Number(fd.get('hourlyRate')),
                },
              });
            }}
            className="space-y-3"
          >
            <Field label="Full name">
              <Input name="name" required defaultValue={editing.name} />
            </Field>
            <Field label="Phone">
              <Input name="phone" type="tel" defaultValue={editing.phone ?? ''} />
            </Field>
            <Field label="Trade">
              <Input name="trade" required defaultValue={editing.trade} />
            </Field>
            <Field label="Agreed hourly rate (KES)">
              <Input
                name="hourlyRate"
                type="number"
                min="0"
                max="5000"
                step="0.01"
                required
                defaultValue={editing.hourlyRate}
              />
            </Field>
            {update.isError && (
              <p className="text-sm text-danger-fg">
                {update.error instanceof ApiRequestError ? update.error.message : 'Failed to save'}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={update.isPending}>
              Save changes
            </Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}
