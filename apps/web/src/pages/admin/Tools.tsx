import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Plus, Repeat } from 'lucide-react';
import { api } from '@/lib/api';
import type { Project, Tool, ToolTransfer } from '@/lib/types';
import { fmtDate, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Empty } from '@/components/ui/table';

export function ToolsPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [transferring, setTransferring] = useState<Tool | null>(null);
  const [historyTool, setHistoryTool] = useState<Tool | null>(null);

  const { data: tools } = useQuery({
    queryKey: ['tools'],
    queryFn: () => api<Tool[]>('/tools'),
  });
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
  });
  const { data: history } = useQuery({
    queryKey: ['tools', 'transfers', historyTool?.id],
    queryFn: () => api<ToolTransfer[]>(`/tools/${historyTool!.id}/transfers`),
    enabled: !!historyTool,
  });

  const createTool = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/tools', { body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tools'] });
      setAddOpen(false);
    },
  });

  const transferTool = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) =>
      api(`/tools/${id}/transfer`, { formData }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['tools'] });
      void qc.invalidateQueries({ queryKey: ['tools', 'transfers', vars.id] });
      setTransferring(null);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Tools</h1>
          <p className="text-sm text-slate-500">Company equipment and where it currently sits</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={16} /> New tool
        </Button>
      </div>

      {tools?.length === 0 && (
        <Empty>No tools registered yet. Add one to start tracking transfers.</Empty>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tools?.map((tool) => (
          <Card key={tool.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-slate-900">{tool.name}</p>
                {tool.category && <p className="text-xs text-slate-500">{tool.category}</p>}
                <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                  {Number(tool.quantity).toLocaleString()}{' '}
                  <span className="text-sm font-normal text-slate-500">{tool.unit}</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {tool.currentProject?.name ?? 'Central store'}
                </p>
              </div>
              <button
                onClick={() => setHistoryTool(tool)}
                aria-label={`History for ${tool.name}`}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <History size={18} />
              </button>
            </div>
            <Button
              size="lg"
              variant="secondary"
              className="mt-3 w-full"
              onClick={() => setTransferring(tool)}
            >
              <Repeat size={18} /> Transfer to another site
            </Button>
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
          {createTool.isError && <p className="text-sm text-red-600">Failed to add tool</p>}
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
            <p className="text-xs text-slate-500">
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
            {transferTool.isError && (
              <p className="text-sm text-red-600">Transfer failed — check the details and try again</p>
            )}
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
            <div key={t.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-800">
                  {t.fromProject?.name ?? 'Central store'} → {t.toProject.name}
                </p>
                <span className="text-xs tabular-nums text-slate-500">
                  {Number(t.quantity).toLocaleString()} {historyTool?.unit}
                </span>
              </div>
              {t.notes && <p className="mt-1 text-xs text-slate-500">{t.notes}</p>}
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
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
