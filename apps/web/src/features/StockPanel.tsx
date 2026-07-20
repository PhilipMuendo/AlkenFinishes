import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, History, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import type { StockItem, StockMovement } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/table';

export function StockPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [movement, setMovement] = useState<{ item: StockItem; type: 'IN' | 'OUT' } | null>(null);
  const [historyItem, setHistoryItem] = useState<StockItem | null>(null);

  const { data: items } = useQuery({
    queryKey: ['stock', projectId],
    queryFn: () => api<StockItem[]>(`/projects/${projectId}/stock`),
  });

  const { data: history } = useQuery({
    queryKey: ['stock-history', historyItem?.id],
    queryFn: () =>
      api<StockMovement[]>(`/projects/${projectId}/stock/${historyItem!.id}/movements`),
    enabled: !!historyItem,
  });

  const createItem = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/projects/${projectId}/stock`, { body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stock', projectId] });
      setAddOpen(false);
    },
  });

  const move = useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: Record<string, unknown> }) =>
      api(`/projects/${projectId}/stock/${itemId}/movements`, { body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stock', projectId] });
      setMovement(null);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={16} /> New material
        </Button>
      </div>

      {items?.length === 0 && (
        <Empty>No materials tracked yet. Add a material to start recording stock.</Empty>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items?.map((item) => (
          <Card key={item.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-slate-900">{item.name}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                  {Number(item.quantity).toLocaleString()}{' '}
                  <span className="text-sm font-normal text-slate-500">{item.unit}</span>
                </p>
              </div>
              <button
                onClick={() => setHistoryItem(item)}
                aria-label={`History for ${item.name}`}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <History size={18} />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                size="lg"
                variant="secondary"
                onClick={() => setMovement({ item, type: 'IN' })}
              >
                <ArrowDownToLine size={18} /> Received
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setMovement({ item, type: 'OUT' })}
              >
                <ArrowUpFromLine size={18} /> Used
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="New material">
        <form
          key={String(addOpen)}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            createItem.mutate({ name: fd.get('name'), unit: fd.get('unit') });
          }}
          className="space-y-3"
        >
          <Field label="Material name">
            <Input name="name" required placeholder="Cement" />
          </Field>
          <Field label="Unit">
            <Input name="unit" required placeholder="bags" />
          </Field>
          <Button type="submit" className="w-full" disabled={createItem.isPending}>
            Add material
          </Button>
        </form>
      </Dialog>

      <Dialog
        open={!!movement}
        onClose={() => setMovement(null)}
        title={movement ? `${movement.item.name} — record movement` : ''}
      >
        {movement && (
          <form
            key={movement.item.id + movement.type}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              move.mutate({
                itemId: movement.item.id,
                body: {
                  type: fd.get('type'),
                  quantity: Number(fd.get('quantity')),
                  reason: fd.get('reason'),
                },
              });
            }}
            className="space-y-3"
          >
            <Field label="Movement type">
              <Select name="type" defaultValue={movement.type}>
                <option value="IN">Received (stock in)</option>
                <option value="OUT">Used (stock out)</option>
                <option value="ADJUSTMENT">Adjustment (set count)</option>
              </Select>
            </Field>
            <Field label="Quantity">
              <Input name="quantity" type="number" min="0.01" step="0.01" inputMode="decimal" required />
            </Field>
            <Field label="Reason">
              <Textarea name="reason" required placeholder="Delivery from supplier / used for bedroom walls" />
            </Field>
            {move.isError && <p className="text-sm text-red-600">Failed — check stock quantity</p>}
            <Button type="submit" size="lg" className="w-full" disabled={move.isPending}>
              Save movement
            </Button>
          </form>
        )}
      </Dialog>

      <Dialog
        open={!!historyItem}
        onClose={() => setHistoryItem(null)}
        title={historyItem ? `${historyItem.name} — history` : ''}
      >
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {history?.length === 0 && <Empty>No movements yet</Empty>}
          {history?.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone={m.type === 'IN' ? 'green' : m.type === 'OUT' ? 'blue' : 'yellow'}>
                    {m.type}
                  </Badge>
                  <span className="text-sm font-medium tabular-nums">
                    {Number(m.quantity).toLocaleString()} {historyItem?.unit}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{m.reason}</p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p>{fmtDate(m.date)}</p>
                <p>{m.user.name}</p>
              </div>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
