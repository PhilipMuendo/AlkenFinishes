import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HardHat, Lock, Plus, Trash2 } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import type { PayrollPreview, PayrollRunDetail, PayrollRunSummary, Project } from '@/lib/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Payroll.
 *
 * Gross comes from attendance already recorded, so the run is a review rather
 * than a data-entry exercise. A run is previewed before it is created and
 * created before it is finalised, because finalising makes it the record of
 * what was withheld from real people.
 */

const monthStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
const monthEnd = (d = new Date()) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function PayrollPage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const [periodFrom, setPeriodFrom] = useState(iso(monthStart()));
  const [periodTo, setPeriodTo] = useState(iso(monthEnd()));
  const [projectId, setProjectId] = useState('');
  const [notes, setNotes] = useState('');

  const { data: runs, isLoading } = useQuery({
    queryKey: ['payroll'],
    queryFn: () => api<PayrollRunSummary[]>('/payroll'),
  });
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
    enabled: creating,
  });

  const body = () => ({
    periodFrom,
    periodTo,
    ...(projectId ? { projectId } : {}),
  });

  const preview = useMutation({
    mutationFn: () => api<PayrollPreview>('/payroll/preview', { body: body() }),
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/payroll', {
        body: { ...body(), ...(notes.trim() ? { notes: notes.trim() } : {}) },
      }),
    onSuccess: (run) => {
      void qc.invalidateQueries({ queryKey: ['payroll'] });
      setCreating(false);
      preview.reset();
      setOpenId(run.id);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/payroll/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['payroll'] }),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payroll"
        description="Wages from attendance, with statutory deductions applied"
      />

      <div className="flex justify-end">
        <Button
          onClick={() => {
            preview.reset();
            create.reset();
            setCreating(true);
          }}
        >
          <Plus size={16} /> New payroll run
        </Button>
      </div>

      {!isLoading && runs?.length === 0 ? (
        <Card>
          <CardContent>
            <Empty icon={HardHat}>
              <p className="font-medium text-fg">No payroll runs yet</p>
              <p className="mt-1 max-w-sm text-fg-muted">
                A run reads the hours already captured by attendance and works out each worker&rsquo;s
                pay. Set your rates in Settings first — deductions stay switched off until you do.
              </p>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* The table scrolls inside the card rather than stretching the page
              on a phone. */}
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Period</Th>
                  <Th>Scope</Th>
                  <Th className="text-right">Workers</Th>
                  <Th className="text-right">Gross</Th>
                  <Th className="text-right">Net paid</Th>
                  <Th className="text-right">Employer cost</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {runs?.map((r) => (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap">
                      <button
                        onClick={() => setOpenId(r.id)}
                        className="font-medium text-fg hover:underline"
                      >
                        {fmtDate(r.periodFrom)} – {fmtDate(r.periodTo)}
                      </button>
                    </Td>
                    <Td>{r.project?.name ?? 'All sites'}</Td>
                    <Td className="text-right tabular-nums">{r.workerCount}</Td>
                    <Td className="text-right tabular-nums">{fmtMoney(r.totals.gross)}</Td>
                    <Td className="text-right font-medium tabular-nums">
                      {fmtMoney(r.totals.netPay)}
                    </Td>
                    <Td className="text-right tabular-nums">{fmtMoney(r.totals.employerCost)}</Td>
                    <Td>
                      {r.status === 'FINALISED' ? (
                        <Badge tone="green">Finalised</Badge>
                      ) : (
                        <Badge>Draft</Badge>
                      )}
                    </Td>
                    <Td className="text-right">
                      {r.status === 'DRAFT' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => remove.mutate(r.id)}
                          disabled={remove.isPending}
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}

      {remove.isError && (
        <p className="text-sm text-red-600">
          {remove.error instanceof ApiRequestError ? remove.error.message : 'Failed to delete'}
        </p>
      )}

      {/* ---- New run ---- */}
      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New payroll run"
        className="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="From">
              <Input
                type="date"
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
              />
            </Field>
            <Field label="To">
              <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
            </Field>
            <Field label="Site" hint="All sites files one return">
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">All sites</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => preview.mutate()}
            disabled={preview.isPending}
          >
            {preview.isPending ? 'Working it out…' : 'Preview this run'}
          </Button>

          {preview.isError && (
            <p className="text-sm text-red-600">
              {preview.error instanceof ApiRequestError
                ? preview.error.message
                : 'Could not build the preview'}
            </p>
          )}

          {preview.data && (
            <>
              {!preview.data.config.enabled && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40">
                  Statutory deductions are switched off, so this run pays each worker their full
                  wage and withholds nothing. Turn them on in Settings once your rates are set.
                </p>
              )}

              {preview.data.lines.length === 0 ? (
                <p className="rounded-lg border border-hairline p-3 text-sm text-fg-muted">
                  No completed attendance in that period. Check the dates, and that shifts have
                  been closed — an open shift has no hours yet.
                </p>
              ) : (
                <>
                  <PayrollLines lines={preview.data.lines} />
                  <Totals totals={preview.data.totals} />

                  <Field label="Notes">
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="min-h-[56px]"
                    />
                  </Field>

                  {create.isError && (
                    <p className="text-sm text-red-600">
                      {create.error instanceof ApiRequestError
                        ? create.error.message
                        : 'Failed to create the run'}
                    </p>
                  )}
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => create.mutate()}
                    disabled={create.isPending}
                  >
                    {create.isPending ? 'Creating…' : 'Create this run'}
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </Dialog>

      <Dialog
        open={!!openId}
        onClose={() => setOpenId(null)}
        title="Payroll run"
        className="max-w-3xl"
      >
        {openId && <RunDetail id={openId} onClose={() => setOpenId(null)} />}
      </Dialog>
    </div>
  );
}

function RunDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['payroll', id],
    queryFn: () => api<PayrollRunDetail>(`/payroll/${id}`),
  });

  const finalise = useMutation({
    mutationFn: () => api(`/payroll/${id}/finalise`, { body: {} }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['payroll'] });
    },
  });

  if (!data) return <p className="py-8 text-center text-sm text-fg-muted">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-fg">
            {fmtDate(data.periodFrom)} – {fmtDate(data.periodTo)}
          </p>
          <p className="text-xs text-fg-subtle">
            {data.project?.name ?? 'All sites'} · {data.lines.length} worker
            {data.lines.length === 1 ? '' : 's'} · raised by {data.createdBy.name}
          </p>
        </div>
        {data.status === 'FINALISED' ? (
          <Badge tone="green">Finalised {data.finalisedAt ? fmtDate(data.finalisedAt) : ''}</Badge>
        ) : (
          <Badge>Draft</Badge>
        )}
      </div>

      <PayrollLines lines={data.lines} />
      <Totals totals={data.totals} />

      {data.status === 'DRAFT' ? (
        <>
          <p className="text-xs text-fg-subtle">
            Finalising makes these figures permanent. After that the run is the record of what was
            withheld from your workers and cannot be deleted or rebuilt.
          </p>
          {finalise.isError && (
            <p className="text-sm text-red-600">
              {finalise.error instanceof ApiRequestError
                ? finalise.error.message
                : 'Failed to finalise'}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Close
            </Button>
            <Button
              className="flex-1"
              onClick={() => finalise.mutate()}
              disabled={finalise.isPending}
            >
              <Lock size={15} /> {finalise.isPending ? 'Finalising…' : 'Finalise run'}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-fg-subtle">
          Computed with the rates in force when the run was made, not today&rsquo;s.
        </p>
      )}
    </div>
  );
}

/** The per-worker table. Scrolls sideways on a phone rather than squashing. */
function PayrollLines({
  lines,
}: {
  lines: { workerId: string; workerName: string; trade: string; hoursWorked: number; gross: number; paye: number; nssf: number; shif: number; housingLevy: number; totalDeductions: number; netPay: number }[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-hairline">
      <Table>
        <thead>
          <tr>
            <Th>Worker</Th>
            <Th className="text-right">Hours</Th>
            <Th className="text-right">Gross</Th>
            <Th className="text-right">PAYE</Th>
            <Th className="text-right">NSSF</Th>
            <Th className="text-right">SHIF</Th>
            <Th className="text-right">Levy</Th>
            <Th className="text-right">Net</Th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.workerId}>
              <Td className="whitespace-nowrap">
                <p className="font-medium text-fg">{l.workerName}</p>
                {l.trade && <p className="text-xs text-fg-subtle">{l.trade}</p>}
              </Td>
              <Td className="text-right tabular-nums">{l.hoursWorked}</Td>
              <Td className="text-right tabular-nums">{fmtMoney(l.gross)}</Td>
              <Td className="text-right tabular-nums">{fmtMoney(l.paye)}</Td>
              <Td className="text-right tabular-nums">{fmtMoney(l.nssf)}</Td>
              <Td className="text-right tabular-nums">{fmtMoney(l.shif)}</Td>
              <Td className="text-right tabular-nums">{fmtMoney(l.housingLevy)}</Td>
              <Td className="text-right font-medium tabular-nums">{fmtMoney(l.netPay)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function Totals({
  totals,
}: {
  totals: PayrollPreview['totals'];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">The wage bill</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <Row label="Gross wages" value={totals.gross} />
          <Row label="Withheld from workers" value={-totals.totalDeductions} />
          <div className="border-t border-hairline pt-1">
            <Row label="Net to pay out" value={totals.netPay} strong />
          </div>
          <div className="border-t border-hairline pt-1">
            <Row label="Total cost to the company" value={totals.employerCost} strong />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">To remit</CardTitle>
          <p className="text-xs text-fg-muted">Employee and employer shares together</p>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <Row label="PAYE" value={totals.remittances.paye} />
          <Row label="NSSF" value={totals.remittances.nssf} />
          <Row label="SHIF" value={totals.remittances.shif} />
          <Row label="Housing levy" value={totals.remittances.housingLevy} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className={strong ? 'font-medium text-fg' : 'text-fg-muted'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-semibold text-fg' : 'text-fg'}`}>
        {value < 0 ? `(${fmtMoney(Math.abs(value))})` : fmtMoney(value)}
      </span>
    </div>
  );
}
