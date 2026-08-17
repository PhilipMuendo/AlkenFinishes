import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { AppUser, Project, ProjectStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { ProjectCard } from '@/components/ProjectCard';

const STATUS_FILTERS: { value: '' | ProjectStatus; label: string }[] = [
  { value: '', label: 'All projects' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PLANNING', label: 'Planning' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function ProjectsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // Filtering client-side: the list is already fetched whole for the cards, so
  // a round trip per keystroke would buy nothing.
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | ProjectStatus>('');
  const { data: projects, isLoading } = useQuery({
    queryKey: queryKeys.projects.all(),
    queryFn: () => api<Project[]>('/projects'),
  });
  const { data: users } = useQuery({
    queryKey: queryKeys.users.all(),
    queryFn: () => api<AppUser[]>('/users'),
  });
  const supervisors = users?.filter((u) => u.role === 'SUPERVISOR' && u.active) ?? [];

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (projects ?? []).filter((p) => {
      if (status && p.status !== status) return false;
      if (!q) return true;
      return [p.name, p.clientName, p.location, p.code ?? ''].some((field) =>
        field.toLowerCase().includes(q),
      );
    });
  }, [projects, search, status]);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/projects', { body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.projects.all() });
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
      status: fd.get('status'),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Construction sites and contracts"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> New project
          </Button>
        }
      />

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && !!projects?.length && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[16rem] flex-1">
            <Field label="Search">
              <Search
                size={15}
                aria-hidden
                className="pointer-events-none absolute bottom-0 left-3 top-[1.85rem] text-fg-subtle"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Project, client, location or code"
                className="pl-9"
              />
            </Field>
          </div>
          <div className="w-44">
            <Field label="Status">
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as '' | ProjectStatus)}
              >
                {STATUS_FILTERS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="nums pb-2.5 text-sm text-fg-muted">
            {visible.length} of {projects.length}
          </p>
        </div>
      )}

      {!isLoading && projects?.length === 0 && (
        <Card>
          <CardContent>
            <Empty icon={Building2}>
              <p className="font-medium text-fg">No projects yet</p>
              <p className="mt-1 max-w-xs text-fg-muted">
                Create your first project to start tracking budgets, payments, and progress.
              </p>
              <Button className="mt-3" onClick={() => setOpen(true)}>
                <Plus size={16} /> New project
              </Button>
            </Empty>
          </CardContent>
        </Card>
      )}

      {!isLoading && !!projects?.length && visible.length === 0 && (
        <Card>
          <CardContent>
            <Empty icon={Search}>
              <p className="font-medium text-fg">Nothing matches those filters</p>
              <p className="mt-1 max-w-xs text-fg-muted">
                Try a different search term, or set the status back to all projects.
              </p>
              <Button
                className="mt-3"
                variant="outline"
                onClick={() => {
                  setSearch('');
                  setStatus('');
                }}
              >
                Clear filters
              </Button>
            </Empty>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((p) => (
          <ProjectCard key={p.id} project={p} />
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
          <Field label="Initial status">
            <Select name="status" defaultValue="PLANNING">
              <option value="PLANNING">Planning</option>
              <option value="ACTIVE">Active</option>
            </Select>
          </Field>
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
          <FormError error={create.error} fallback="Failed to create project" />
          <Button type="submit" className="w-full" disabled={create.isPending}>
            Create project
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
