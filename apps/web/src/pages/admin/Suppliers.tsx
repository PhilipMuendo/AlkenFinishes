import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Plus, Truck } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { AgingBucket, PayablesReport, Supplier } from '@/lib/types';
import { fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

/**
 * Suppliers and what we owe them.
 *
 * The page answers one question first — who is owed money, and how late is it
 * — because that is what decides whether tomorrow's delivery turns up. The
 * supplier list is underneath, not on top.
 */

const AGING_LABEL: Record<AgingBucket, string> = {
  CURRENT: 'Not yet due',
  D1_30: '1–30 days',
  D31_60: '31–60 days',
  D61_90: '61–90 days',
  D90_PLUS: 'Over 90 days',
};

export function SuppliersPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  const { data: payables } = useQuery({
    queryKey: ['suppliers', 'payables'],
    queryFn: () => api<PayablesReport>('/suppliers/payables'),
  });
  const { data: suppliers, isLoading } = useQuery({
    // Its own key. This list includes retired suppliers; the pickers elsewhere
    // fetch active-only from `/suppliers`. Sharing one key meant whichever
    // screen fetched last won, and the retired rows — the only ones with a
    // Reactivate button — vanished from this page at random.
    queryKey: ['suppliers', 'all'],
    queryFn: () => api<Supplier[]>('/suppliers?includeInactive=true'),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['suppliers'] });
  };

  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Record<string, unknown> }) =>
      id ? api(`/suppliers/${id}`, { method: 'PUT', body }) : api('/suppliers', { body }),
    onSuccess: (_r, vars) => {
      toast.success(vars.id ? 'Supplier updated.' : 'Supplier added.');
      invalidate();
      setAdding(false);
      setEditing(null);
    },
    onError: (e) => toast.error(errText(e, 'The supplier was not saved.')),
  });

  const retire = useMutation({
    mutationFn: (id: string) => api(`/suppliers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Supplier retired. Their history and any balance owed stay on the record.');
      invalidate();
    },
    onError: (e) => toast.error(errText(e, 'The supplier was not retired.')),
  });

  const reactivate = useMutation({
    mutationFn: (id: string) => api(`/suppliers/${id}`, { method: 'PUT', body: { active: true } }),
    onSuccess: () => {
      toast.success('Supplier reactivated.');
      invalidate();
    },
    onError: (e) => toast.error(errText(e, 'The supplier was not reactivated.')),
  });

  const s = payables?.summary;

  return (
    <div className="space-y-5">
      {/* Wraps rather than squashing the button off a narrow phone. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-fg">Suppliers &amp; payables</h1>
          <p className="text-sm text-fg-muted">What we owe, who to, and how overdue it is</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} /> Add supplier
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Owed to suppliers"
          value={s?.outstanding ?? 0}
          hint={
            s?.supplierCount
              ? `${s.supplierCount} supplier${s.supplierCount === 1 ? '' : 's'} · ${s.openBills} open bill${s.openBills === 1 ? '' : 's'}`
              : 'Nothing outstanding'
          }
        />
        <Tile
          label="Overdue"
          value={s?.overdue ?? 0}
          hint={
            s?.oldestOverdueDays
              ? `Oldest is ${s.oldestOverdueDays} days past due`
              : 'Nothing past its due date'
          }
          tone={s && s.overdue > 0 ? 'negative' : undefined}
        />
        <Tile
          label="Tax withheld"
          value={s?.taxWithheld ?? 0}
          hint="Deducted from suppliers and owed to KRA"
        />
        <Tile
          label="Reclaimable input VAT"
          value={s?.reclaimableVat ?? 0}
          hint="Backed by a supplier tax invoice"
        />
      </div>

      {s && s.outstanding > 0 && (
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">How old the debt is</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-5">
              {(Object.keys(AGING_LABEL) as AgingBucket[]).map((b) => (
                <div key={b} className="rounded-lg border border-hairline px-3 py-2">
                  <p className="text-xs text-fg-subtle">{AGING_LABEL[b]}</p>
                  <p
                    className={`mt-0.5 font-semibold tabular-nums ${
                      b === 'D90_PLUS' && s.aging[b] > 0 ? 'text-danger-fg' : 'text-fg'
                    }`}
                  >
                    {fmtMoney(s.aging[b])}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {payables && payables.suppliers.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Who is owed</CardTitle>
          </CardHeader>
          <Table>
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th className="text-right">Billed</Th>
                <Th className="text-right">Settled</Th>
                <Th className="text-right">Outstanding</Th>
                <Th>Open bills</Th>
              </tr>
            </thead>
            <tbody>
              {payables.suppliers.map((p) => (
                <tr key={p.supplierId}>
                  <Td>
                    <p className="font-medium text-fg">{p.name}</p>
                    {p.phone && (
                      <p className="flex items-center gap-1 text-xs text-fg-subtle">
                        <Phone size={11} /> {p.phone}
                      </p>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{fmtMoney(p.billed)}</Td>
                  <Td className="text-right tabular-nums">
                    {fmtMoney(p.paid)}
                    {p.taxWithheld > 0 && (
                      <p className="text-xs text-fg-subtle">
                        incl. {fmtMoney(p.taxWithheld)} withheld
                      </p>
                    )}
                  </Td>
                  <Td className="text-right font-medium tabular-nums">
                    <span className={p.overdue > 0 ? 'text-danger-fg' : 'text-fg'}>
                      {fmtMoney(p.outstanding)}
                    </span>
                    {p.oldestOverdueDays != null && (
                      <p className="text-xs text-danger-fg">{p.oldestOverdueDays}d late</p>
                    )}
                  </Td>
                  <Td>{p.openBills}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">Supplier list</CardTitle>
        </CardHeader>
        {!isLoading && suppliers?.length === 0 ? (
          <CardContent>
            <Empty icon={Truck}>
              <p className="font-medium text-fg">No suppliers yet</p>
              <p className="mt-1 max-w-sm text-fg-muted">
                Add the merchants you buy from. Once a purchase names a supplier it goes on the
                payables list, and you can record what you pay against it — in parts, if that is
                how it was paid.
              </p>
            </Empty>
          </CardContent>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Contact</Th>
                <Th>KRA PIN</Th>
                <Th className="text-right">Outstanding</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {suppliers?.map((sup) => (
                <tr key={sup.id} className={sup.active ? undefined : 'opacity-55'}>
                  <Td>
                    <p className="font-medium text-fg">{sup.name}</p>
                    {!sup.active && <Badge>Retired</Badge>}
                  </Td>
                  <Td>
                    {sup.contactName && <p className="text-fg">{sup.contactName}</p>}
                    <p className="text-xs text-fg-subtle">
                      {[sup.phone, sup.email].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </Td>
                  <Td className="text-fg-muted">{sup.kraPin || '—'}</Td>
                  <Td className="text-right font-medium tabular-nums">
                    {sup.position ? fmtMoney(sup.position.outstanding) : '—'}
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setEditing(sup)}>
                        Edit
                      </Button>
                      {sup.active ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => retire.mutate(sup.id)}
                          disabled={retire.isPending}
                        >
                          Retire
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => reactivate.mutate(sup.id)}
                          disabled={reactivate.isPending}
                        >
                          Reactivate
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {retire.isError && (
        <p className="text-sm text-danger-fg">
          {retire.error instanceof ApiRequestError
            ? retire.error.message
            : 'Failed to retire that supplier'}
        </p>
      )}

      <Dialog
        open={adding || !!editing}
        onClose={() => {
          setAdding(false);
          setEditing(null);
          save.reset();
        }}
        title={editing ? `Edit ${editing.name}` : 'Add supplier'}
      >
        <SupplierForm
          key={editing?.id ?? 'new'}
          existing={editing}
          pending={save.isPending}
          error={save.error}
          onSubmit={(body) => save.mutate({ id: editing?.id, body })}
        />
      </Dialog>
    </div>
  );
}

function SupplierForm({
  existing,
  pending,
  error,
  onSubmit,
}: {
  existing: Supplier | null;
  pending: boolean;
  error: unknown;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSubmit(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v).trim()])));
      }}
      className="space-y-3"
    >
      <Field label="Supplier name">
        <Input name="name" required defaultValue={existing?.name ?? ''} autoFocus />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Contact person">
          <Input name="contactName" defaultValue={existing?.contactName ?? ''} />
        </Field>
        <Field label="Phone">
          <Input name="phone" defaultValue={existing?.phone ?? ''} />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" defaultValue={existing?.email ?? ''} />
        </Field>
        <Field label="KRA PIN" hint="Needed for withholding certificates">
          <Input name="kraPin" defaultValue={existing?.kraPin ?? ''} />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea name="notes" className="min-h-[60px]" defaultValue={existing?.notes ?? ''} />
      </Field>
      {error != null && (
        <p className="text-sm text-danger-fg">
          {error instanceof ApiRequestError ? error.message : 'Failed to save this supplier'}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {existing ? 'Save changes' : 'Add supplier'}
      </Button>
    </form>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: 'negative';
}) {
  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={`text-xl font-semibold tabular-nums ${
            tone === 'negative' && value > 0 ? 'text-danger-fg' : 'text-fg'
          }`}
        >
          {fmtMoney(value)}
        </p>
        <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p>
      </CardContent>
    </Card>
  );
}
