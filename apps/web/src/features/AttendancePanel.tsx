import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, PenLine } from 'lucide-react';
import { api } from '@/lib/api';
import type { AttendanceRecord, Worker } from '@/lib/types';
import { fmtDate, fmtMoney, fmtTime, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th, Empty } from '@/components/ui/table';

/**
 * Attendance is device-first: records stream in from fingerprint devices via
 * the sync API. The UI is read-mostly; a flagged manual override exists for
 * device-failure days and is visibly marked and audited.
 */
export function AttendancePanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [overrideOpen, setOverrideOpen] = useState(false);

  const { data: records } = useQuery({
    queryKey: ['attendance', projectId],
    queryFn: () => api<AttendanceRecord[]>(`/projects/${projectId}/attendance`),
  });
  const { data: workers } = useQuery({
    queryKey: ['workers'],
    queryFn: () => api<Worker[]>('/workers'),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['attendance', projectId] });
    void qc.invalidateQueries({ queryKey: ['analytics', 'project', projectId] });
    void qc.invalidateQueries({ queryKey: ['analytics', 'company'] });
  };

  const override = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/projects/${projectId}/attendance/manual-override`, { body }),
    onSuccess: () => {
      invalidate();
      setOverrideOpen(false);
    },
  });

  const checkout = useMutation({
    mutationFn: (id: string) =>
      api(`/projects/${projectId}/attendance/${id}/checkout`, {
        body: { checkOut: new Date().toISOString() },
      }),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Fingerprint size={16} className="text-brand-600" />
          Records sync automatically from fingerprint devices
        </p>
        <Button variant="outline" size="sm" onClick={() => setOverrideOpen(true)}>
          <PenLine size={14} /> Manual override
        </Button>
      </div>

      {records?.length === 0 ? (
        <Empty>
          No attendance records yet.
          <span>Connect a fingerprint device or use manual override for device failures.</span>
        </Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Worker</Th>
              <Th>In</Th>
              <Th>Out</Th>
              <Th className="text-right">Hours</Th>
              <Th className="text-right">Labour cost</Th>
              <Th>Method</Th>
            </tr>
          </thead>
          <tbody>
            {records?.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">{fmtDate(r.date)}</Td>
                <Td>
                  <span className="font-medium">{r.worker.name}</span>
                  <p className="text-xs text-slate-500">{r.worker.trade}</p>
                </Td>
                <Td className="tabular-nums">{fmtTime(r.checkIn)}</Td>
                <Td className="tabular-nums">
                  {r.checkOut ? (
                    fmtTime(r.checkOut)
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => checkout.mutate(r.id)}
                      disabled={checkout.isPending}
                    >
                      Check out
                    </Button>
                  )}
                </Td>
                <Td className="text-right tabular-nums">{r.hoursWorked ?? '—'}</Td>
                <Td className="text-right tabular-nums">
                  {r.labourCost ? fmtMoney(Number(r.labourCost)) : '—'}
                </Td>
                <Td>
                  {r.method === 'FINGERPRINT' ? (
                    <Badge tone="green">
                      <Fingerprint size={12} /> Biometric
                    </Badge>
                  ) : (
                    <Badge tone="yellow">
                      <PenLine size={12} /> Manual
                    </Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Manual attendance override"
      >
        <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          Manual entries are flagged and audit-logged. Use only when the fingerprint device is
          unavailable.
        </p>
        <form
          key={String(overrideOpen)}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const date = fd.get('date') as string;
            const checkIn = `${date}T${fd.get('checkIn')}:00`;
            const out = fd.get('checkOut') as string;
            override.mutate({
              workerId: fd.get('workerId'),
              date,
              checkIn: new Date(checkIn).toISOString(),
              checkOut: out ? new Date(`${date}T${out}:00`).toISOString() : null,
              reason: fd.get('reason'),
            });
          }}
          className="space-y-3"
        >
          <Field label="Worker">
            <Select name="workerId" required>
              <option value="">Select worker…</option>
              {workers?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} — {w.trade}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date">
            <Input name="date" type="date" defaultValue={todayISO()} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in">
              <Input name="checkIn" type="time" required />
            </Field>
            <Field label="Check-out (optional)">
              <Input name="checkOut" type="time" />
            </Field>
          </div>
          <Field label="Reason for manual entry">
            <Textarea name="reason" required placeholder="Device battery died" />
          </Field>
          {override.isError && (
            <p className="text-sm text-red-600">
              Failed — the worker may already have a record for this day
            </p>
          )}
          <Button type="submit" className="w-full" disabled={override.isPending}>
            Save override
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
