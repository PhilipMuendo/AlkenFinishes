import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Search } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { Client } from '@/lib/types';
import { fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';

/**
 * The client register — where a customer is entered once and then only ever
 * selected. Everything downstream (leads, quotations, contracts, sites)
 * points back at a row on this page.
 */
export function ClientsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [open, setOpen] = useState(false);

  const { data: clients, isLoading } = useQuery({
    queryKey: ['clients', q],
    queryFn: () => api<Client[]>(`/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['clients'] });

  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Record<string, unknown> }) =>
      id ? api(`/clients/${id}`, { method: 'PUT', body }) : api('/clients', { body }),
    onSuccess: (_r, vars) => {
      toast.success(vars.id ? 'Client updated.' : 'Client added.');
      invalidate();
      setOpen(false);
      setEditing(null);
    },
    onError: (e) => toast.error(errText(e, 'The client was not saved.')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/clients/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Client deleted.');
      invalidate();
      setEditing(null);
    },
    onError: (e) => toast.error(errText(e, 'The client was not deleted.')),
  });

  const startNew = () => {
    setEditing(null);
    save.reset();
    setOpen(true);
  };
  const startEdit = (c: Client) => {
    setEditing(c);
    save.reset();
    remove.reset();
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Enter a client once — every quotation, contract and site reuses them"
        actions={
          <Button onClick={startNew}>
            <Plus size={16} /> Add client
          </Button>
        }
      />

      <div className="relative max-w-sm">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, contact or phone"
          aria-label="Search clients"
          className="pl-9"
        />
      </div>

      {isLoading && <Skeleton className="h-64 w-full rounded-xl" />}

      {!isLoading && clients?.length === 0 && (
        <Empty icon={Building2}>
          <p className="font-medium text-fg">
            {q ? 'No clients match that search' : 'No clients yet'}
          </p>
          <p className="mt-1 max-w-xs text-fg-muted">
            {q
              ? 'Try a shorter search term.'
              : 'Add your first client, then raise a quotation against them.'}
          </p>
          {!q && (
            <Button className="mt-3" onClick={startNew}>
              <Plus size={16} /> Add client
            </Button>
          )}
        </Empty>
      )}

      {!isLoading && !!clients?.length && (
        <Card className="overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Client</Th>
                <Th priority="sm">Contact</Th>
                <Th priority="lg" className="text-right">Quotations</Th>
                <Th priority="lg" className="text-right">Contracts</Th>
                <Th priority="lg" className="text-right">Sites</Th>
                <Th className="text-right">Contracted to date</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <span className="font-medium text-fg">{c.name}</span>
                    {c.kraPin && <p className="text-xs text-fg-subtle">KRA {c.kraPin}</p>}
                  </Td>
                  <Td priority="sm">
                    {c.contactPerson ?? <span className="text-fg-subtle">—</span>}
                    <p className="text-xs text-fg-subtle">{c.phone ?? c.email ?? ''}</p>
                  </Td>
                  <Td priority="lg" className="text-right tabular-nums">{c._count.quotations}</Td>
                  <Td priority="lg" className="text-right tabular-nums">{c._count.contracts}</Td>
                  <Td priority="lg" className="text-right tabular-nums">{c._count.projects}</Td>
                  <Td className="text-right tabular-nums">
                    {c.totalContractValue > 0 ? (
                      fmtMoney(c.totalContractValue)
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <Button size="sm" variant="outline" onClick={() => startEdit(c)}>
                      Edit
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
        title={editing ? `Edit ${editing.name}` : 'Add client'}
      >
        <form
          key={editing?.id ?? 'new'}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            save.mutate({
              id: editing?.id,
              body: Object.fromEntries(fd.entries()),
            });
          }}
          className="space-y-3"
        >
          <Field label="Client name">
            <Input name="name" defaultValue={editing?.name} required autoFocus />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contact person">
              <Input name="contactPerson" defaultValue={editing?.contactPerson ?? ''} />
            </Field>
            <Field label="Phone">
              <Input name="phone" type="tel" defaultValue={editing?.phone ?? ''} />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" defaultValue={editing?.email ?? ''} />
            </Field>
            <Field label="KRA PIN">
              <Input name="kraPin" defaultValue={editing?.kraPin ?? ''} placeholder="P051234567X" />
            </Field>
          </div>
          <Field label="Address">
            <Textarea name="address" defaultValue={editing?.address ?? ''} rows={2} />
          </Field>
          <Field label="Notes">
            <Textarea name="notes" defaultValue={editing?.notes ?? ''} rows={2} />
          </Field>

          {editing && (
            <p className="text-xs text-fg-subtle">
              Renaming a client here does not change quotations, contracts or projects already on
              file — those record the name as it stood when they were issued.
            </p>
          )}

          {save.isError && (
            <p className="text-sm text-danger-fg">
              {save.error instanceof ApiRequestError ? save.error.message : 'Failed to save'}
            </p>
          )}
          {remove.isError && (
            <p className="text-sm text-danger-fg">
              {remove.error instanceof ApiRequestError
                ? remove.error.message
                : 'Failed to delete this client'}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            {editing && (
              <Button
                type="button"
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => setDeleting(editing)}
              >
                Delete
              </Button>
            )}
            <Button type="submit" className="flex-1" disabled={save.isPending}>
              {editing ? 'Save changes' : 'Add client'}
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => {
          setDeleting(null);
          remove.reset();
        }}
        title="Delete this client?"
        description={
          deleting
            ? `${deleting.name} will be removed from the register. Everything filed under them — ${deleting._count.leads} lead${deleting._count.leads === 1 ? '' : 's'}, ${deleting._count.quotations} quotation${deleting._count.quotations === 1 ? '' : 's'}, ${deleting._count.contracts} contract${deleting._count.contracts === 1 ? '' : 's'}, ${deleting._count.projects} site${deleting._count.projects === 1 ? '' : 's'} — has to be cleared first.`
            : undefined
        }
        confirmLabel="Delete client"
        pending={remove.isPending}
        error={remove.isError ? errText(remove.error, 'The client was not deleted.') : null}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
