import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { Client } from '@/lib/types';
import { fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { FormError } from '@/components/ui/form-error';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The client register — where a customer is entered once and then only ever
 * selected. Everything downstream (leads, quotations, contracts, projects)
 * points back at a row on this page.
 */
export function ClientsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Client | null>(null);
  const [open, setOpen] = useState(false);

  const { data: clients, isLoading } = useQuery({
    queryKey: queryKeys.clients.list(q),
    queryFn: () => api<Client[]>(`/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: queryKeys.clients.all() });

  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Record<string, unknown> }) =>
      id ? api(`/clients/${id}`, { method: 'PUT', body }) : api('/clients', { body }),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/clients/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      toast.success('Client deleted');
      setEditing(null);
    },
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
        description="Enter a client once — every quotation, contract and project reuses them"
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
        <Card>
          <CardContent>
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
          </CardContent>
        </Card>
      )}

      {!isLoading && !!clients?.length && (
        <Card className="overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Client</Th>
                <Th>Contact</Th>
                <Th className="text-right">Quotations</Th>
                <Th className="text-right">Contracts</Th>
                <Th className="text-right">Projects</Th>
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
                  <Td>
                    {c.contactPerson ?? <span className="text-fg-subtle">—</span>}
                    <p className="text-xs text-fg-subtle">{c.phone ?? c.email ?? ''}</p>
                  </Td>
                  <Td className="nums text-right">{c._count.quotations}</Td>
                  <Td className="nums text-right">{c._count.contracts}</Td>
                  <Td className="nums text-right">{c._count.projects}</Td>
                  <Td className="nums text-right">
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

          <FormError error={save.error} fallback="Failed to save" />
          <FormError error={remove.error} fallback="Failed to delete this client" />

          <div className="flex gap-2 pt-1">
            {editing && (
              <Button
                type="button"
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate(editing.id)}
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
    </div>
  );
}
