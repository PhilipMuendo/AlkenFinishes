import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Plus, Repeat, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { Project, Tool, ToolTransfer } from '@/lib/types';
import { fmtDate, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';

export function ToolsPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [transferring, setTransferring] = useState<Tool | null>(null);
  const [historyTool, setHistoryTool] = useState<Tool | null>(null);

  const { data: tools } = useQuery({
    queryKey: queryKeys.tools.all(),
    queryFn: () => api<Tool[]>('/tools'),
  });
  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.all(),
    queryFn: () => api<Project[]>('/projects'),
  });
  const { data: history } = useQuery({
    queryKey: queryKeys.tools.transfers(historyTool?.id),
    queryFn: () => api<ToolTransfer[]>(`/tools/${historyTool!.id}/transfers`),
    enabled: !!historyTool,
  });

  const createTool = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/tools', { body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tools.all() });
      setAddOpen(false);
    },
  });

  const transferTool = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) =>
      api(`/tools/${id}/transfer`, { formData }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.tools.all() });
      void qc.invalidateQueries({ queryKey: queryKeys.tools.transfers(vars.id) });
      setTransferring(null);
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Tool['status'] }) =>
      api(`/tools/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.tools.all() }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tools"
        description="Company equipment and where it currently sits"
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus size={16} /> New tool
          </Button>
        }
      />

      {tools?.length === 0 && (
        <Card>
          <CardContent>
            <Empty icon={Wrench}>
              <p className="font-medium text-fg">No tools registered yet</p>
              <p className="mt-1 max-w-xs text-fg-muted">
                Add equipment to track where it sits and move it between sites with photo proof.
              </p>
              <Button className="mt-3" onClick={() => setAddOpen(true)}>
                <Plus size={16} /> New tool
              </Button>
            </Empty>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools?.map((tool) => (
          <Card key={tool.id} className="p-4 transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold text-fg">{tool.name}</p>
                  {tool.status !== 'ACTIVE' && (
                    <Badge tone={tool.status === 'RETIRED' ? 'red' : 'yellow'}>
                      {tool.status === 'RETIRED' ? 'Retired' : 'Under maintenance'}
                    </Badge>
                  )}
                </div>
                {tool.category && <p className="text-xs text-fg-subtle">{tool.category}</p>}
                <p className="nums mt-2 text-2xl font-semibold tracking-tight text-fg">
                  {Number(tool.quantity).toLocaleString()}{' '}
                  <span className="text-sm font-normal text-fg-subtle">{tool.unit}</span>
                </p>
                <p className="mt-1 text-xs text-fg-muted">
                  {tool.currentProject?.name ?? 'Central store'}
                </p>
                {tool.conditionNotes && (
                  <p className="mt-1 text-xs text-fg-subtle">{tool.conditionNotes}</p>
                )}
              </div>
              <button
                onClick={() => setHistoryTool(tool)}
                aria-label={`History for ${tool.name}`}
                className="rounded-lg p-2 text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg"
              >
                <History size={18} />
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                size="lg"
                variant="secondary"
                className="flex-1"
                disabled={tool.status !== 'ACTIVE'}
                onClick={() => setTransferring(tool)}
              >
                <Repeat size={18} /> Transfer
              </Button>
              <Select
                aria-label={`Status for ${tool.name}`}
                className="w-auto"
                value={tool.status}
                onChange={(e) =>
                  setStatus.mutate({ id: tool.id, status: e.target.value as Tool['status'] })
                }
              >
                <option value="ACTIVE">Active</option>
                <option value="MAINTENANCE">Maintenance</option>
                <option value="RETIRED">Retired</option>
              </Select>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="New tool">
        <form
          key={String(addOpen)}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            createTool.mutate({
              name: fd.get('name'),
              category: fd.get('category') || null,
              unit: fd.get('unit') || 'pcs',
              quantity: Number(fd.get('quantity')),
              currentProjectId: fd.get('currentProjectId') || null,
            });
          }}
          className="space-y-3"
        >
          <Field label="Tool name">
            <Input name="name" required placeholder="Paint brush set" />
          </Field>
          <Field label="Category (optional)">
            <Input name="category" placeholder="Hand tools, Power tools…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <Input name="quantity" type="number" min="0" step="1" required defaultValue={1} />
            </Field>
            <Field label="Unit">
              <Input name="unit" defaultValue="pcs" required />
            </Field>
          </div>
          <Field label="Current site">
            <Select name="currentProjectId" defaultValue="">
              <option value="">Central store</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <FormError error={createTool.error} fallback="Failed to add tool" />
          <Button type="submit" className="w-full" disabled={createTool.isPending}>
            Add tool
          </Button>
        </form>
      </Dialog>

      <Dialog
        open={!!transferring}
        onClose={() => setTransferring(null)}
        title={transferring ? `Transfer ${transferring.name}` : ''}
      >
        {transferring && (
          <form
            key={transferring.id}
            onSubmit={(e) => {
              e.preventDefault();
              transferTool.mutate({ id: transferring.id, formData: new FormData(e.currentTarget) });
            }}
            className="space-y-3"
          >
            <p className="text-xs text-fg-muted">
              Currently at: {transferring.currentProject?.name ?? 'Central store'} ·{' '}
              {Number(transferring.quantity).toLocaleString()} {transferring.unit}
            </p>
            <Field label="Destination site">
              <Select name="toProjectId" required defaultValue="">
                <option value="" disabled>
                  Select site…
                </option>
                {projects
                  ?.filter((p) => p.id !== transferring.currentProject?.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Transfer date">
              <Input name="transferDate" type="date" defaultValue={todayISO()} />
            </Field>
            <Field label="Notes (optional)">
              <Textarea name="notes" placeholder="Delivered via site vehicle" />
            </Field>
            <Field label="Proof of delivery photo">
              <Input
                name="proofPhoto"
                type="file"
                accept="image/*"
                capture="environment"
                required
              />
            </Field>
            <FormError
              error={transferTool.error}
              fallback="Transfer failed — check the details and try again"
            />
            <Button type="submit" size="lg" className="w-full" disabled={transferTool.isPending}>
              Confirm transfer
            </Button>
          </form>
        )}
      </Dialog>

      <Dialog
        open={!!historyTool}
        onClose={() => setHistoryTool(null)}
        title={historyTool ? `${historyTool.name} — transfer history` : ''}
      >
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {history?.length === 0 && <Empty>No transfers yet</Empty>}
          {history?.map((t) => (
            <div key={t.id} className="rounded-lg border border-hairline p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-fg">
                  {t.fromProject?.name ?? 'Central store'} → {t.toProject.name}
                </p>
                <span className="nums text-xs text-fg-muted">
                  {Number(t.quantity).toLocaleString()} {historyTool?.unit}
                </span>
              </div>
              {t.notes && <p className="mt-1 text-xs text-fg-muted">{t.notes}</p>}
              <div className="mt-2 flex items-center justify-between text-xs text-fg-muted">
                <a
                  href={t.proofPhotoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-700 hover:underline"
                >
                  View delivery photo
                </a>
                <span>
                  {fmtDate(t.transferDate)} · {t.transferredBy.name}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
