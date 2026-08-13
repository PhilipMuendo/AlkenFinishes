import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Pencil, Plus } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { MaterialRequest, MaterialRequestStatus, StockItem } from '@/lib/types';
import { fmtDate, todayISO } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

const NEW_ITEM = '__new__';

const STATUS_TONE: Record<MaterialRequestStatus, 'yellow' | 'blue' | 'green' | 'red'> = {
  PENDING: 'yellow',
  APPROVED: 'blue',
  FULFILLED: 'green',
  REJECTED: 'red',
};

/**
 * A supervisor asks for materials, the office decides and marks it fulfilled
 * once it arrives — at which point fulfilment logs an ordinary stock IN
 * movement below. Sits above the stock grid in the Stock tab: "what's needed"
 * naturally reads before "what's on hand".
 */
export function MaterialRequestsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPERADMIN';
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState<MaterialRequest | null>(null);
  const [editing, setEditing] = useState<MaterialRequest | null>(null);

  // Shared by the create and edit forms: pick an existing StockItem by id,
  // or NEW_ITEM to name (and unit) one that doesn't exist yet.
  const [pickItem, setPickItem] = useState(NEW_ITEM);
  const [customName, setCustomName] = useState('');
  const [customUnit, setCustomUnit] = useState('');
  const resolveMaterial = () => {
    const picked = pickItem !== NEW_ITEM ? stockItems?.find((i) => i.id === pickItem) : undefined;
    return { itemName: picked?.name ?? customName, unit: picked?.unit ?? customUnit };
  };

  const { data: requests } = useQuery({
    queryKey: ['material-requests', projectId],
    queryFn: () => api<MaterialRequest[]>(`/projects/${projectId}/material-requests`),
  });

  // Shares its cache with StockPanel's own fetch (same key), so mounting
  // both costs one request, not two. Existing names are offered as a
  // dropdown so a request lands on the exact same StockItem row when it's
  // fulfilled, instead of spawning a near-duplicate from a typo or a
  // different casing.
  const { data: stockItems } = useQuery({
    queryKey: ['stock', projectId],
    queryFn: () => api<StockItem[]>(`/projects/${projectId}/stock`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['material-requests', projectId] });
    void qc.invalidateQueries({ queryKey: ['stock', projectId] });
  };

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/projects/${projectId}/material-requests`, { body }),
    onSuccess: () => {
      toast.success('Material request sent to the office.');
      invalidate();
      setOpen(false);
    },
    onError: (e) => toast.error(errText(e, 'The request was not sent.')),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/material-requests/${id}/approve`, { body: {} }),
    onSuccess: () => {
      toast.success('Request approved. Mark it fulfilled once the materials reach site.');
      invalidate();
    },
    onError: (e) => toast.error(errText(e, 'The request was not approved.')),
  });

  const fulfil = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/material-requests/${id}/fulfil`, { body: {} }),
    onSuccess: () => {
      toast.success('Marked as delivered to site.');
      invalidate();
    },
    onError: (e) => toast.error(errText(e, 'The request was not marked delivered.')),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/projects/${projectId}/material-requests/${id}/reject`, { body: { reason } }),
    onSuccess: () => {
      toast.success('Request rejected. The reason is on the record.');
      invalidate();
      setRejecting(null);
    },
    onError: (e) => toast.error(errText(e, 'The request was not rejected.')),
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/material-requests/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Request withdrawn.');
      invalidate();
    },
    onError: (e) => toast.error(errText(e, 'The request was not withdrawn.')),
  });

  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/projects/${projectId}/material-requests/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      toast.success('Request updated.');
      invalidate();
      setEditing(null);
    },
    onError: (e) => toast.error(errText(e, 'The request was not updated.')),
  });

  const open_ = requests?.filter((r) => r.status !== 'FULFILLED' && r.status !== 'REJECTED') ?? [];
  const settled = requests?.filter((r) => r.status === 'FULFILLED' || r.status === 'REJECTED') ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Material requests</h3>
        <Button
          size="sm"
          onClick={() => {
            setPickItem(NEW_ITEM);
            setCustomName('');
            setCustomUnit('');
            setOpen(true);
          }}
        >
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
                <Badge tone={STATUS_TONE[r.status]} className="shrink-0 capitalize">
                  {r.status.toLowerCase()}
                </Badge>
              </div>
              <div className="mt-2 flex gap-1.5">
                {isAdmin && (r.status === 'PENDING' || r.status === 'APPROVED') && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const match = stockItems?.find((i) => i.name === r.itemName);
                      setPickItem(match?.id ?? NEW_ITEM);
                      setCustomName(r.itemName);
                      setCustomUnit(r.unit);
                      setEditing(r);
                    }}
                  >
                    <Pencil size={14} /> Edit
                  </Button>
                )}
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
                <Badge tone={STATUS_TONE[r.status]} className="capitalize">
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
            const { itemName, unit } = resolveMaterial();
            create.mutate({
              itemName,
              quantity: Number(fd.get('quantity')),
              unit,
              neededBy: fd.get('neededBy') || undefined,
              notes: fd.get('notes') || undefined,
            });
          }}
          className="space-y-3"
        >
          <Field label="Material">
            <Select value={pickItem} onChange={(e) => setPickItem(e.target.value)}>
              <option value={NEW_ITEM}>+ Add new material</option>
              {stockItems?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
          {pickItem === NEW_ITEM && (
            <Field label="New material name">
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                required
                placeholder="Cement 50kg"
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <Input name="quantity" type="number" min="0.01" step="0.01" required />
            </Field>
            <Field label="Unit">
              {pickItem === NEW_ITEM ? (
                <Input
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value)}
                  required
                  placeholder="bags"
                />
              ) : (
                <Input value={stockItems?.find((i) => i.id === pickItem)?.unit ?? ''} disabled />
              )}
            </Field>
          </div>
          <Field label="Needed by (optional)">
            <Input name="neededBy" type="date" min={todayISO()} />
          </Field>
          <Field label="Notes (optional)">
            <Textarea name="notes" rows={2} placeholder="For floor screed, block A" />
          </Field>
          {create.isError && (
            <p className="text-sm text-danger-fg">
              {create.error instanceof ApiRequestError ? create.error.message : 'Failed to save'}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={create.isPending}>
            Send request
          </Button>
        </form>
      </Dialog>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit request">
        <form
          key={editing?.id ?? 'none'}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const { itemName, unit } = resolveMaterial();
            edit.mutate({
              id: editing!.id,
              body: { itemName, quantity: Number(fd.get('quantity')), unit },
            });
          }}
          className="space-y-3"
        >
          <Field label="Material">
            <Select value={pickItem} onChange={(e) => setPickItem(e.target.value)}>
              <option value={NEW_ITEM}>+ Add new material</option>
              {stockItems?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
          {pickItem === NEW_ITEM && (
            <Field label="New material name">
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                required
                placeholder="Cement 50kg"
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <Input
                name="quantity"
                type="number"
                min="0.01"
                step="0.01"
                required
                defaultValue={editing?.quantity}
              />
            </Field>
            <Field label="Unit">
              {pickItem === NEW_ITEM ? (
                <Input
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value)}
                  required
                  placeholder="bags"
                />
              ) : (
                <Input value={stockItems?.find((i) => i.id === pickItem)?.unit ?? ''} disabled />
              )}
            </Field>
          </div>
          {edit.isError && (
            <p className="text-sm text-danger-fg">
              {edit.error instanceof ApiRequestError ? edit.error.message : 'Failed to save'}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={edit.isPending}>
            Save changes
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
          {reject.isError && (
            <p className="text-sm text-danger-fg">
              {reject.error instanceof ApiRequestError ? reject.error.message : 'Failed to save'}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={reject.isPending}>
            Decline request
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
