import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/lib/auth';
import type { MaterialRequest } from '@/lib/types';
import { fmtDate, todayISO } from '@/lib/format';
import { materialRequestStatusTone } from '@/lib/tone';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { FormError } from '@/components/ui/form-error';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Empty } from '@/components/ui/table';


/**
 * A supervisor asks for materials, the office decides and marks it fulfilled
 * once it arrives — at which point fulfilment logs an ordinary stock IN
 * movement below. Sits above the stock grid in the Stock tab: "what's needed"
 * naturally reads before "what's on hand".
 */
export function MaterialRequestsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPERADMIN';
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState<MaterialRequest | null>(null);

  const { data: requests } = useQuery({
    queryKey: queryKeys.materialRequests.byProject(projectId),
    queryFn: () => api<MaterialRequest[]>(`/projects/${projectId}/material-requests`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.materialRequests.byProject(projectId) });
    void qc.invalidateQueries({ queryKey: queryKeys.stock.byProject(projectId) });
  };

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/projects/${projectId}/material-requests`, { body }),
    onSuccess: () => {
      invalidate();
      setOpen(false);
    },
  });

  const approve = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/material-requests/${id}/approve`, { body: {} }),
    onSuccess: invalidate,
  });

  const fulfil = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/material-requests/${id}/fulfil`, { body: {} }),
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/projects/${projectId}/material-requests/${id}/reject`, { body: { reason } }),
    onSuccess: () => {
      invalidate();
      setRejecting(null);
    },
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/material-requests/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      toast.success('Request withdrawn');
    },
  });

  const open_ = requests?.filter((r) => r.status !== 'FULFILLED' && r.status !== 'REJECTED') ?? [];
  const settled = requests?.filter((r) => r.status === 'FULFILLED' || r.status === 'REJECTED') ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">Material requests</h2>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus size={14} /> Request material
        </Button>
      </div>

      {requests?.length === 0 && (
        <Card className="p-4">
          <Empty icon={ClipboardList}>
            <p className="text-sm text-fg-muted">Nothing requested yet.</p>
          </Empty>
        </Card>
      )}

      {open_.length > 0 && (
        <div className="space-y-2">
          {open_.map((r) => (
            <Card key={r.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-fg">
                    {r.quantity} {r.unit} — {r.itemName}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    Requested by {r.requestedBy.name} · {fmtDate(r.createdAt)}
                    {r.neededBy && ` · needed by ${fmtDate(r.neededBy)}`}
                  </p>
                  {r.notes && <p className="mt-1 text-xs text-fg-muted">{r.notes}</p>}
                </div>
                <Badge tone={materialRequestStatusTone[r.status]} className="shrink-0 capitalize">
                  {r.status.toLowerCase()}
                </Badge>
              </div>
              <div className="mt-2 flex gap-1.5">
                {isAdmin && r.status === 'PENDING' && (
                  <>
                    <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(r.id)}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setRejecting(r)}>
                      Reject
                    </Button>
                  </>
                )}
                {isAdmin && r.status === 'APPROVED' && (
                  <Button size="sm" disabled={fulfil.isPending} onClick={() => fulfil.mutate(r.id)}>
                    Mark received
                  </Button>
                )}
                {!isAdmin && r.status === 'PENDING' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={withdraw.isPending}
                    onClick={() => withdraw.mutate(r.id)}
                  >
                    Withdraw
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {settled.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-fg-muted">
            {settled.length} settled request{settled.length > 1 ? 's' : ''}
          </summary>
          <div className="mt-2 space-y-2">
            {settled.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-hairline p-2.5 text-xs">
                <span>
                  {r.quantity} {r.unit} — {r.itemName}
                </span>
                <Badge tone={materialRequestStatusTone[r.status]} className="capitalize">
                  {r.status.toLowerCase()}
                </Badge>
              </div>
            ))}
          </div>
        </details>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="Request material">
        <form
          key={String(open)}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            create.mutate({
              itemName: fd.get('itemName'),
              quantity: Number(fd.get('quantity')),
              unit: fd.get('unit'),
              neededBy: fd.get('neededBy') || undefined,
              notes: fd.get('notes') || undefined,
            });
          }}
          className="space-y-3"
        >
          <Field label="Material">
            <Input name="itemName" required placeholder="Cement 50kg" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <Input name="quantity" type="number" min="0.01" step="0.01" required />
            </Field>
            <Field label="Unit">
              <Input name="unit" required placeholder="bags" />
            </Field>
          </div>
          <Field label="Needed by (optional)">
            <Input name="neededBy" type="date" min={todayISO()} />
          </Field>
          <Field label="Notes (optional)">
            <Textarea name="notes" rows={2} placeholder="For floor screed, block A" />
          </Field>
          <FormError error={create.error} fallback="Failed to save" />
          <Button type="submit" className="w-full" disabled={create.isPending}>
            Send request
          </Button>
        </form>
      </Dialog>

      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} title="Decline this request">
        <form
          key={rejecting?.id ?? 'none'}
          onSubmit={(e) => {
            e.preventDefault();
            reject.mutate({
              id: rejecting!.id,
              reason: String(new FormData(e.currentTarget).get('reason')),
            });
          }}
          className="space-y-3"
        >
          <Field label="Why?">
            <Textarea name="reason" required rows={2} autoFocus />
          </Field>
          <FormError error={reject.error} fallback="Failed to save" />
          <Button type="submit" className="w-full" disabled={reject.isPending}>
            Decline request
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
