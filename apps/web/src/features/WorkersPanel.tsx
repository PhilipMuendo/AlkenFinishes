import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HardHat, Pencil, Plus, UserMinus } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { Worker } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { QueryState } from '@/components/ui/query-state';
import { Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

/**
 * Supervisor-facing fundi roster for a single site: add a casual fundi,
 * edit their contact details, or take them off this site. No hourly-rate
 * visibility restriction — the site rate is something a supervisor agrees
 * with the fundi directly, unlike site-level budget/financials.
 */
export function WorkersPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Worker | null>(null);
  const [removing, setRemoving] = useState<Worker | null>(null);

  const allWorkersQuery = useQuery({
    queryKey: ['workers'],
    queryFn: () => api<Worker[]>('/workers'),
  });
  const { data: allWorkers } = allWorkersQuery;
  // GET /workers returns fundis across every site this supervisor covers;
  // narrow to the one being viewed right now.
  const workers = allWorkers?.filter((w) =>
    w.assignments.some((a) => a.project.id === projectId),
  );

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['workers'] });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/workers', { body: { ...body, projectId } }),
    onSuccess: () => {
      toast.success('Fundi put on this site. Their hours here now accrue against its budget.');
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
      toast.success('Fundi taken off this site. Their record and history are kept.');
      invalidate();
      setRemoving(null);
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

      <QueryState query={allWorkersQuery} rows={3} noun="the fundi list" />

      {workers?.length === 0 && (
        <Empty icon={HardHat}>
          <p className="font-medium text-fg">No fundis on this site yet</p>
          <p className="mt-1 max-w-xs text-fg-muted">
            Add a casual fundi to start tracking their attendance and hours here.
          </p>
        </Empty>
      )}

      <div className="space-y-2">
        {workers?.map((w) => (
          <Card key={w.id} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate font-semibold text-fg">{w.name}</p>
              <p className="truncate text-xs text-fg-muted">
                {w.trade} · {w.phone || 'No phone'}
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
                onClick={() => setRemoving(w)}
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
          {/* No pay rate. It is the office's to agree, it feeds labour cost and
              budget health, and it is set from the Workers screen there. */}
          <p className="text-xs text-fg-subtle">
            The office sets this fundi&rsquo;s rate. Attendance recorded here will cost nothing
            against the budget until they do.
          </p>
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

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => {
          setRemoving(null);
          remove.reset();
        }}
        title="Take this fundi off the site?"
        description={
          removing
            ? `${removing.name} stops appearing on this site’s roster and cannot be clocked in here. Everything already recorded — their attendance, hours and pay — is kept, and the office can put them back on at any time.`
            : undefined
        }
        confirmLabel="Take off site"
        pending={remove.isPending}
        error={remove.isError ? errText(remove.error, 'The fundi was not removed.') : null}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </div>
  );
}
