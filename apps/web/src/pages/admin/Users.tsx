import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import type { AppUser } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th } from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

export function UsersPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => api<AppUser[]>('/users'),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/users', { body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      setOpen(false);
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/users/${id}`, { method: 'PATCH', body: { active } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="Supervisors and administrators"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> Add user
          </Button>
        }
      />

      <Card className="overflow-hidden">
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Role</Th>
            <Th>Assigned sites</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {users?.map((u) => (
            <tr key={u.id}>
              <Td>
                <span className="font-medium text-fg">{u.name}</span>
                <p className="text-xs text-fg-subtle">{u.phone ?? ''}</p>
              </Td>
              <Td>{u.email}</Td>
              <Td>
                <Badge tone={u.role === 'SUPERADMIN' ? 'blue' : 'slate'}>
                  {u.role === 'SUPERADMIN' ? 'Admin' : 'Supervisor'}
                </Badge>
              </Td>
              <Td>{u.projects.map((p) => p.name).join(', ') || '—'}</Td>
              <Td>
                <Badge tone={u.active ? 'green' : 'red'}>{u.active ? 'Active' : 'Disabled'}</Badge>
              </Td>
              <Td className="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggle.mutate({ id: u.id, active: !u.active })}
                >
                  {u.active ? 'Disable' : 'Enable'}
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add user">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            create.mutate({
              name: fd.get('name'),
              email: fd.get('email'),
              phone: fd.get('phone') || undefined,
              password: fd.get('password'),
              role: fd.get('role'),
            });
          }}
          className="space-y-3"
        >
          <Field label="Full name">
            <Input name="name" required />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" required />
          </Field>
          <Field label="Phone">
            <Input name="phone" type="tel" />
          </Field>
          <Field label="Temporary password (min 8 characters)">
            <Input name="password" type="text" minLength={8} required />
          </Field>
          <Field label="Role">
            <Select name="role" defaultValue="SUPERVISOR">
              <option value="SUPERVISOR">Site Supervisor</option>
              <option value="SUPERADMIN">Superadmin</option>
            </Select>
          </Field>
          {create.isError && <p className="text-sm text-red-600">Failed — email may already exist</p>}
          <Button type="submit" className="w-full" disabled={create.isPending}>
            Create user
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
