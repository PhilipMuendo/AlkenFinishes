import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, Boxes, History, Plus } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { StockItem, StockMovement } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { QueryState } from '@/components/ui/query-state';
import { Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { MaterialRequestsPanel } from './MaterialRequestsPanel';

export function StockPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [movement, setMovement] = useState<{ item: StockItem; type: 'IN' | 'OUT' } | null>(null);
  const [historyItem, setHistoryItem] = useState<StockItem | null>(null);

  const itemsQuery = useQuery({
    queryKey: ['stock', projectId],
    queryFn: () => api<StockItem[]>(`/projects/${projectId}/stock`),
  });
  const { data: items } = itemsQuery;

  const { data: history } = useQuery({
    queryKey: ['stock-history', historyItem?.id],
    queryFn: () =>
      api<StockMovement[]>(`/projects/${projectId}/stock/${historyItem!.id}/movements`),
    enabled: !!historyItem,
  });

  const createItem = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/projects/${projectId}/stock`, { body }),
    onSuccess: () => {
      toast.success('Material added to site stock.');
      void qc.invalidateQueries({ queryKey: ['stock', projectId] });
      setAddOpen(false);
    },
    onError: (e) => toast.error(errText(e, 'The material was not added.')),
  });

  const move = useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: Record<string, unknown> }) =>
      api(`/projects/${projectId}/stock/${itemId}/movements`, { body }),
    onSuccess: () => {
      toast.success('Stock movement recorded.');
      void qc.invalidateQueries({ queryKey: ['stock', projectId] });
      setMovement(null);
    },
    onError: (e) => toast.error(errText(e, 'The movement was not recorded.')),
  });

  return (
    <div className="space-y-6">
      <MaterialRequestsPanel projectId={projectId} />

      <div className="flex items-center justify-between border-t border-hairline pt-4">
        <h3 className="text-sm font-semibold text-fg">Materials on hand</h3>
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={16} /> New material
        </Button>
      </div>

      <QueryState query={itemsQuery} rows={3} noun="site stock" />

      {items?.length === 0 && (
        <Empty variant="inline" icon={Boxes}>
          <p className="font-medium text-fg">No materials tracked yet</p>
          <p className="mt-1 max-w-xs text-fg-muted">
            Add a material first (e.g. &ldquo;Tiles&rdquo;, unit &ldquo;pieces&rdquo;) — then use{' '}
            <span className="font-medium text-fg">Received</span> and{' '}
            <span className="font-medium text-fg">Used</span> on it to log deliveries and usage.
            Every change is recorded and visible in its history.
          </p>
        </Empty>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items?.map((item) => {
          const last = item.movements?.[0];
          return (
            <Card key={item.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-fg">{item.name}</p>
                  <p className="nums mt-1 text-2xl font-semibold tracking-tight text-fg">
                    {Number(item.quantity).toLocaleString()}{' '}
                    <span className="text-sm font-normal text-fg-subtle">{item.unit}</span>
                  </p>
                </div>
                <button
                  onClick={() => setHistoryItem(item)}
                  aria-label={`History for ${item.name}`}
                  className="rounded-lg p-2 text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg"
                >
                  <History size={18} />
                </button>
              </div>
              {last ? (
                <p className="mt-2 truncate text-xs text-fg-subtle">
                  Last: {last.type === 'OUT' ? '−' : '+'}
                  {Number(last.quantity).toLocaleString()} {item.unit} · {last.reason} ·{' '}
                  {fmtDate(last.date)}
                </p>
              ) : (
                <p className="mt-2 text-xs text-fg-subtle">No activity logged yet</p>
              )}
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
          );
        })}
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
          {createItem.isError && (
            <p className="text-sm text-danger-fg">
              {createItem.error instanceof ApiRequestError
                ? createItem.error.message
                : 'Failed to add material'}
            </p>
          )}
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
            {move.isError && (
              <p className="text-sm text-danger-fg">
                {move.error instanceof ApiRequestError ? move.error.message : 'Failed to save movement'}
              </p>
            )}
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
          {history?.length === 0 && <Empty variant="inline">No movements yet</Empty>}
          {history?.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-lg border border-hairline p-3">
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone={m.type === 'IN' ? 'green' : m.type === 'OUT' ? 'blue' : 'yellow'}>
                    {m.type}
                  </Badge>
                  <span className="nums text-sm font-medium">
                    {Number(m.quantity).toLocaleString()} {historyItem?.unit}
                  </span>
                </div>
                <p className="mt-1 text-xs text-fg-muted">{m.reason}</p>
              </div>
              <div className="text-right text-xs text-fg-subtle">
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
