import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
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
  const [resetting, setResetting] = useState<AppUser | null>(null);
  const [deleting, setDeleting] = useState<AppUser | null>(null);

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

  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api(`/users/${id}`, { method: 'PATCH', body: { password } }),
    onSuccess: () => setResetting(null),
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      setDeleting(null);
    },
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
                <div className="flex justify-end gap-1.5">
                  <button
                    className="rounded-lg p-2 text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg"
                    aria-label={`Reset password for ${u.name}`}
                    onClick={() => setResetting(u)}
                  >
                    <KeyRound size={16} />
                  </button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggle.mutate({ id: u.id, active: !u.active })}
                  >
                    {u.active ? 'Disable' : 'Enable'}
                  </Button>
                  <button
                    className="rounded-lg p-2 text-fg-subtle transition-colors hover:bg-red-50 hover:text-red-600"
                    aria-label={`Delete ${u.name}`}
                    onClick={() => setDeleting(u)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
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
          {create.isError && (
            <p className="text-sm text-red-600">
              {create.error instanceof ApiRequestError
                ? create.error.message
                : 'Failed — email may already exist'}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={create.isPending}>
            Create user
          </Button>
        </form>
      </Dialog>

      <Dialog
        open={!!resetting}
        onClose={() => setResetting(null)}
        title={resetting ? `Reset password — ${resetting.name}` : ''}
      >
        {resetting && (
          <form
            key={resetting.id}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              resetPassword.mutate({ id: resetting.id, password: fd.get('password') as string });
            }}
            className="space-y-3"
          >
            <p className="text-sm text-fg-muted">
              Set a new temporary password for <span className="font-medium text-fg">{resetting.email}</span>.
              Share it with them directly — they aren&rsquo;t notified automatically.
            </p>
            <Field label="New password (min 8 characters)">
              <Input name="password" type="text" minLength={8} required autoFocus />
            </Field>
            {resetPassword.isError && (
              <p className="text-sm text-red-600">Failed to reset the password</p>
            )}
            <Button type="submit" className="w-full" disabled={resetPassword.isPending}>
              Set new password
            </Button>
          </form>
        )}
      </Dialog>

      <Dialog
        open={!!deleting}
        onClose={() => {
          setDeleting(null);
          deleteUser.reset();
        }}
        title={deleting ? `Delete ${deleting.name}?` : ''}
      >
        {deleting && (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              This permanently removes <span className="font-medium text-fg">{deleting.email}</span>.
              This can&rsquo;t be undone. If you might need this account again, use{' '}
              <span className="font-medium text-fg">Disable</span> instead — it blocks sign-in but
              keeps their history.
            </p>
            {deleteUser.isError && (
              <p className="text-sm text-red-600">
                {deleteUser.error instanceof ApiRequestError
                  ? deleteUser.error.message
                  : 'Failed to delete this account'}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setDeleting(null);
                  deleteUser.reset();
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={deleteUser.isPending}
                onClick={() => deleteUser.mutate(deleting.id)}
              >
                Delete permanently
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
