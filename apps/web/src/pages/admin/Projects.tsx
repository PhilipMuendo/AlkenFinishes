import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import type { AppUser, Project } from '@/lib/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Empty } from '@/components/ui/table';

export function ProjectsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
  });
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => api<AppUser[]>('/users'),
  });
  const supervisors = users?.filter((u) => u.role === 'SUPERVISOR' && u.active) ?? [];

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/projects', { body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
    },
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    create.mutate({
      name: fd.get('name'),
      clientName: fd.get('clientName'),
      location: fd.get('location'),
      contractValue: Number(fd.get('contractValue')),
      startDate: fd.get('startDate'),
      expectedCompletion: fd.get('expectedCompletion'),
      supervisorId: fd.get('supervisorId') || null,
      status: 'ACTIVE',
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Projects</h1>
          <p className="text-sm text-slate-500">Construction sites and contracts</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> New project
        </Button>
      </div>

      {projects?.length === 0 && (
        <Card>
          <CardContent className="pt-5">
            <Empty>No projects yet. Create your first project to get started.</Empty>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.map((p) => (
          <Link key={p.id} to={`/admin/projects/${p.id}`}>
            <Card className="h-full p-4 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{p.name}</p>
                  <p className="text-xs text-slate-500">
                    {p.clientName} · {p.location}
                  </p>
                </div>
                <StatusBadge status={p.status} />
              </div>
              <p className="mt-3 text-lg font-semibold tabular-nums text-slate-900">
                {fmtMoney(Number(p.contractValue))}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Progress value={p.progressPct} health="GREEN" />
                <span className="text-xs tabular-nums text-slate-600">{p.progressPct}%</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {fmtDate(p.startDate)} → {fmtDate(p.expectedCompletion)} ·{' '}
                {p.supervisor?.name ?? 'No supervisor'}
              </p>
            </Card>
          </Link>
        ))}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="New project">
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Project name">
            <Input name="name" required placeholder="Karen Residence" />
          </Field>
          <Field label="Client name">
            <Input name="clientName" required />
          </Field>
          <Field label="Location">
            <Input name="location" required />
          </Field>
          <Field label="Contract value (KES)">
            <Input name="contractValue" type="number" min="0" step="0.01" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <Input name="startDate" type="date" required />
            </Field>
            <Field label="Expected completion">
              <Input name="expectedCompletion" type="date" required />
            </Field>
          </div>
          <Field label="Supervisor">
            <Select name="supervisorId" defaultValue="">
              <option value="">Unassigned</option>
              {supervisors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          {create.isError && <p className="text-sm text-red-600">Failed to create project</p>}
          <Button type="submit" className="w-full" disabled={create.isPending}>
            Create project
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
