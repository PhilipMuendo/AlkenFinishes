import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import type { Project, Worker } from '@/lib/types';
import { fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th, Empty } from '@/components/ui/table';

export function WorkersPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState<Worker | null>(null);

  const { data: workers } = useQuery({
    queryKey: ['workers'],
    queryFn: () => api<Worker[]>('/workers'),
  });
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['workers'] });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/workers', { body }),
    onSuccess: () => {
      invalidate();
      setOpen(false);
    },
  });

  const assign = useMutation({
    mutationFn: ({ workerId, projectId }: { workerId: string; projectId: string }) =>
      api(`/workers/${workerId}/assign`, { body: { projectId } }),
    onSuccess: () => {
      invalidate();
      setAssigning(null);
    },
  });

  const unassign = useMutation({
    mutationFn: (workerId: string) => api(`/workers/${workerId}/unassign`, { body: {} }),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Workers</h1>
          <p className="text-sm text-slate-500">Fundis and site workers across all projects</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> Add worker
        </Button>
      </div>

      {workers?.length === 0 ? (
        <Empty>No workers registered yet</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Trade</Th>
              <Th className="text-right">Hourly rate</Th>
              <Th>Biometric ID</Th>
              <Th>Current site</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {workers?.map((w) => (
              <tr key={w.id}>
                <Td>
                  <span className="font-medium">{w.name}</span>
                  <p className="text-xs text-slate-500">{w.phone ?? '—'}</p>
                </Td>
                <Td>{w.trade}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(Number(w.hourlyRate))}/hr</Td>
                <Td>
                  {w.biometricId ? (
                    <Badge tone="green">Enrolled</Badge>
                  ) : (
                    <Badge tone="yellow">Not enrolled</Badge>
                  )}
                </Td>
                <Td>{w.assignments[0]?.project.name ?? <span className="text-slate-400">Unassigned</span>}</Td>
                <Td>
                  <Badge tone={w.status === 'ACTIVE' ? 'green' : 'slate'}>{w.status}</Badge>
                </Td>
                <Td className="text-right">
                  {w.assignments[0] ? (
                    <Button size="sm" variant="outline" onClick={() => unassign.mutate(w.id)}>
                      Unassign
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setAssigning(w)}>
                      Assign to site
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="Add worker">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            create.mutate({
              name: fd.get('name'),
              phone: fd.get('phone') || null,
              trade: fd.get('trade'),
              hourlyRate: Number(fd.get('hourlyRate')),
              biometricId: fd.get('biometricId') || null,
            });
          }}
          className="space-y-3"
        >
          <Field label="Full name">
            <Input name="name" required />
          </Field>
          <Field label="Phone">
            <Input name="phone" type="tel" />
          </Field>
          <Field label="Trade">
            <Input name="trade" required placeholder="Painter, Tiler, Mason…" />
          </Field>
          <Field label="Hourly rate (KES)">
            <Input name="hourlyRate" type="number" min="0" step="0.01" required />
          </Field>
          <Field label="Biometric ID (from fingerprint device)">
            <Input name="biometricId" placeholder="Device enrolment ID" />
          </Field>
          {create.isError && <p className="text-sm text-red-600">Failed to add worker</p>}
          <Button type="submit" className="w-full" disabled={create.isPending}>
            Add worker
          </Button>
        </form>
      </Dialog>

      <Dialog
        open={!!assigning}
        onClose={() => setAssigning(null)}
        title={assigning ? `Assign ${assigning.name}` : ''}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            assign.mutate({ workerId: assigning!.id, projectId: fd.get('projectId') as string });
          }}
          className="space-y-3"
        >
          <Field label="Site / project">
            <Select name="projectId" required>
              <option value="">Select site…</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" className="w-full" disabled={assign.isPending}>
            Assign
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
