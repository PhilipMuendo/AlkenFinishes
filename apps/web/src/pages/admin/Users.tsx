import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { AppUser } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { QueryState } from '@/components/ui/query-state';
import { Table, Td, Th } from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { toast } from '@/components/ui/toast';

export function UsersPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState<AppUser | null>(null);
  const [deleting, setDeleting] = useState<AppUser | null>(null);

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api<AppUser[]>('/users'),
  });
  const { data: users } = usersQuery;

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/users', { body }),
    onSuccess: () => {
      toast.success('User created. Give them their sign-in details directly.');
      void qc.invalidateQueries({ queryKey: ['users'] });
      setOpen(false);
    },
    onError: (e) => toast.error(errText(e, 'The user was not created.')),
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/users/${id}`, { method: 'PATCH', body: { active } }),
    onSuccess: (_r, vars) => {
      toast.success(vars.active ? 'User reactivated.' : 'User deactivated. They can no longer sign in.');
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(errText(e, 'The user was not updated.')),
  });

  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api(`/users/${id}`, { method: 'PATCH', body: { password } }),
    onSuccess: () => {
      toast.success('Password reset. Pass it to them directly, not by email.');
      setResetting(null);
    },
    onError: (e) => toast.error(errText(e, 'The password was not reset.')),
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('User deleted.');
      void qc.invalidateQueries({ queryKey: ['users'] });
      setDeleting(null);
    },
    onError: (e) => toast.error(errText(e, 'The user was not deleted.')),
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

      <QueryState query={usersQuery} rows={4} noun="the team" />

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
                    className="rounded-lg p-2 text-fg-subtle transition-colors hover:bg-danger-surface hover:text-danger-fg"
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
            <p className="text-sm text-danger-fg">
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
              <p className="text-sm text-danger-fg">Failed to reset the password</p>
            )}
            <Button type="submit" className="w-full" disabled={resetPassword.isPending}>
              Set new password
            </Button>
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => {
          setDeleting(null);
          deleteUser.reset();
        }}
        title={deleting ? `Delete ${deleting.name}?` : ''}
        description={
          deleting
            ? `This permanently removes ${deleting.email}, and cannot be undone. If you might need the account again, disable it instead — that blocks sign-in but keeps their history.`
            : undefined
        }
        confirmLabel="Delete permanently"
        pending={deleteUser.isPending}
        error={deleteUser.isError ? errText(deleteUser.error, 'The account was not deleted.') : null}
        onConfirm={() => deleting && deleteUser.mutate(deleting.id)}
      />
    </div>
  );
}
