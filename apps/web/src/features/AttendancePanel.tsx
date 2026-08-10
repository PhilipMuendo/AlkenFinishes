import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, MapPin, PenLine } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AttendanceOverrideRequest, AttendanceRecord, Project, Worker } from '@/lib/types';
import { fmtDate, fmtMoney, fmtTime, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

/** Wraps the browser geolocation callback API in a promise; null if denied/unavailable. */
function getLocation(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  });
}

/**
 * Attendance is device-first: records stream in from fingerprint devices.
 * A manual entry is never written directly — a supervisor can only file a
 * request, with GPS captured at submission, and a superadmin decides. That
 * request/decide split is what keeps supervisors out of editing hours.
 */
export function AttendancePanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPERADMIN';
  const [requestOpen, setRequestOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [rejecting, setRejecting] = useState<AttendanceOverrideRequest | null>(null);

  const { data: records } = useQuery({
    queryKey: ['attendance', projectId],
    queryFn: () => api<AttendanceRecord[]>(`/projects/${projectId}/attendance`),
  });
  const { data: workers } = useQuery({
    queryKey: ['workers', projectId],
    queryFn: () => api<Worker[]>(`/workers?projectId=${projectId}`),
  });
  const { data: requests } = useQuery({
    queryKey: ['attendance-override-requests', projectId],
    queryFn: () => api<AttendanceOverrideRequest[]>(`/projects/${projectId}/attendance/override-requests`),
  });
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<Project>(`/projects/${projectId}`),
    enabled: isAdmin,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['attendance', projectId] });
    void qc.invalidateQueries({ queryKey: ['attendance-override-requests', projectId] });
    void qc.invalidateQueries({ queryKey: ['analytics', 'project', projectId] });
    void qc.invalidateQueries({ queryKey: ['analytics', 'company'] });
  };

  const request = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/projects/${projectId}/attendance/override-requests`, { body }),
    onSuccess: () => {
      toast.success('Sent to the office for approval.');
      invalidate();
      setRequestOpen(false);
    },
    onError: (e) => toast.error(errText(e, 'The request was not sent.')),
  });

  const decide = useMutation({
    mutationFn: ({ id, outcome, reason }: { id: string; outcome: 'APPROVED' | 'REJECTED'; reason?: string }) =>
      api(`/projects/${projectId}/attendance/override-requests/${id}/decision`, {
        body: { outcome, reason },
      }),
    onSuccess: (_r, vars) => {
      toast.success(
        vars.outcome === 'APPROVED'
          ? 'Approved. The hours now count towards pay.'
          : 'Rejected. The reason is on the record.',
      );
      invalidate();
      setRejecting(null);
    },
    onError: (e) => toast.error(errText(e, 'The decision was not saved.')),
  });

  const checkout = useMutation({
    mutationFn: (id: string) =>
      api(`/projects/${projectId}/attendance/${id}/checkout`, { body: {} }),
    onSuccess: () => {
      toast.success('Checked out. Hours are counted from check-in to now.');
      invalidate();
    },
    onError: (e) => toast.error(errText(e, 'The check-out was not recorded.')),
  });

  const pending = requests?.filter((r) => r.status === 'PENDING') ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Fingerprint size={16} className="text-brand-600" />
          Records sync automatically from fingerprint devices
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={capturing}
          onClick={async () => {
            setCapturing(true);
            await getLocation(); // warm the permission prompt before the dialog opens
            setCapturing(false);
            setRequestOpen(true);
          }}
        >
          <PenLine size={14} /> Request manual entry
        </Button>
      </div>

      {isAdmin && project && <GeofenceCard project={project} />}

      {isAdmin && pending.length > 0 && (
        <div className="space-y-2 rounded-xl border border-warn-hairline bg-warn-surface p-3">
          <p className="text-sm font-medium text-warn-fg">
            {pending.length} manual entry request{pending.length > 1 ? 's' : ''} awaiting a decision
          </p>
          {pending.map((r) => (
            <div key={r.id} className="rounded-lg border border-warn-hairline bg-surface p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-fg">
                    {r.worker.name} · {fmtDate(r.date)}
                  </p>
                  <p className="text-xs text-fg-muted">
                    {fmtTime(r.checkIn)} – {r.checkOut ? fmtTime(r.checkOut) : 'open'} · requested by{' '}
                    {r.requestedBy.name}
                  </p>
                  <p className="mt-1 text-sm text-fg">{r.reason}</p>
                  <GeofenceSignal req={r} />
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: r.id, outcome: 'APPROVED' })}
                  >
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejecting(r)}>
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isAdmin && pending.length > 0 && (
        <div className="rounded-xl border border-warn-hairline bg-warn-surface px-4 py-3 text-sm text-warn-fg">
          {pending.length} of your manual entry request{pending.length > 1 ? 's are' : ' is'} waiting
          on the office.
        </div>
      )}

      {records?.length === 0 ? (
        <Empty>
          No attendance records yet.
          <span>Connect a fingerprint device or request a manual entry for device failures.</span>
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
              {isAdmin && <Th className="text-right">Labour cost</Th>}
              <Th>Method</Th>
            </tr>
          </thead>
          <tbody>
            {records?.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">{fmtDate(r.date)}</Td>
                <Td>
                  <span className="font-medium">{r.worker.name}</span>
                  <p className="text-xs text-fg-muted">{r.worker.trade}</p>
                </Td>
                <Td className="tabular-nums">{fmtTime(r.checkIn)}</Td>
                <Td className="tabular-nums">
                  {r.checkOut ? (
                    fmtTime(r.checkOut)
                  ) : isAdmin ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => checkout.mutate(r.id)}
                      disabled={checkout.isPending}
                    >
                      Check out
                    </Button>
                  ) : (
                    <span className="text-fg-subtle">Open</span>
                  )}
                </Td>
                <Td className="text-right tabular-nums">
                  {r.hoursWorked ?? '—'}
                  {r.hoursWorked != null && Number(r.hoursWorked) > 8 && (
                    <span className="ml-1 text-xs text-warn-fg">
                      ({(Number(r.hoursWorked) - 8).toFixed(1)}h OT)
                    </span>
                  )}
                </Td>
                {/* Cost divided by hours is the pay rate, which is the
                    office's business — the server omits it for supervisors, so
                    this column would be empty rather than merely hidden. */}
                {isAdmin && (
                  <Td className="text-right tabular-nums">
                    {r.labourCost ? fmtMoney(Number(r.labourCost)) : '—'}
                  </Td>
                )}
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
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        title="Request a manual attendance entry"
      >
        <p className="mb-3 rounded-lg bg-warn-surface p-3 text-xs text-warn-fg">
          This only files a request — the office decides. Your device's location is captured and
          shown to them alongside it.
        </p>
        <form
          key={String(requestOpen)}
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const date = fd.get('date') as string;
            const checkIn = `${date}T${fd.get('checkIn')}:00`;
            const out = fd.get('checkOut') as string;
            const loc = await getLocation();
            request.mutate({
              workerId: fd.get('workerId'),
              date,
              checkIn: new Date(checkIn).toISOString(),
              checkOut: out ? new Date(`${date}T${out}:00`).toISOString() : null,
              reason: fd.get('reason'),
              latitude: loc?.lat,
              longitude: loc?.lng,
            });
          }}
          className="space-y-3"
        >
          <Field label="Worker">
            <Combobox
              name="workerId"
              placeholder="Search worker…"
              aria-label="Worker"
              options={(workers ?? []).map((w) => ({ value: w.id, label: `${w.name} — ${w.trade}` }))}
            />
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
          {request.isError && (
            <p className="text-sm text-danger-fg">
              {request.error instanceof ApiRequestError
                ? request.error.message
                : 'Failed to send the request'}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={request.isPending}>
            Send request
          </Button>
        </form>
      </Dialog>

      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} title="Decline this request">
        <form
          key={rejecting?.id ?? 'none'}
          onSubmit={(e) => {
            e.preventDefault();
            decide.mutate({
              id: rejecting!.id,
              outcome: 'REJECTED',
              reason: String(new FormData(e.currentTarget).get('reason')),
            });
          }}
          className="space-y-3"
        >
          <Field label="Why?">
            <Textarea name="reason" required rows={2} autoFocus />
          </Field>
          {decide.isError && (
            <p className="text-sm text-danger-fg">
              {decide.error instanceof ApiRequestError ? decide.error.message : 'Failed to save'}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={decide.isPending}>
            Decline request
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

/** GPS captured at submission is a deterrent, not a gate — shown, not enforced. */
function GeofenceSignal({ req }: { req: AttendanceOverrideRequest }) {
  if (req.withinGeofence === null) {
    return req.latitude ? (
      <p className="mt-1 flex items-center gap-1 text-xs text-fg-subtle">
        <MapPin size={12} /> Location captured, no geofence set for this site
      </p>
    ) : (
      <p className="mt-1 text-xs text-fg-subtle">No location captured</p>
    );
  }
  return (
    <p
      className={
        'mt-1 flex items-center gap-1 text-xs ' +
        (req.withinGeofence ? 'text-good-fg' : 'text-danger-fg')
      }
    >
      <MapPin size={12} />
      {req.withinGeofence ? 'Within the site geofence' : 'Outside the site geofence'}
    </p>
  );
}

function GeofenceCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [capturing, setCapturing] = useState(false);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/projects/${project.id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      toast.success('Site attendance settings saved.');
      void qc.invalidateQueries({ queryKey: ['project', project.id] });
    },
    onError: (e) => toast.error(errText(e, 'The settings were not saved.')),
  });

  const hasGeofence = project.geofenceLat != null && project.geofenceLng != null;

  return (
    <details className="rounded-xl border border-hairline bg-surface-muted/40 p-3">
      <summary className="cursor-pointer text-sm font-medium text-fg-muted">
        Site geofence {hasGeofence ? `— set (${project.geofenceRadiusM}m radius)` : '— not set'}
      </summary>
      <form
        id="geofence-form"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          save.mutate({
            geofenceLat: Number(fd.get('geofenceLat')),
            geofenceLng: Number(fd.get('geofenceLng')),
            geofenceRadiusM: Number(fd.get('geofenceRadiusM')),
          });
        }}
        className="mt-3 space-y-3"
      >
        <p className="text-xs text-fg-subtle">
          Fingerprint terminals need none of this — a device can't move. This only informs manual
          entry requests, letting the office see whether the request was made from the site.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={capturing}
          onClick={async () => {
            setCapturing(true);
            const loc = await getLocation();
            setCapturing(false);
            if (!loc) return;
            const form = document.getElementById('geofence-form') as HTMLFormElement;
            (form.elements.namedItem('geofenceLat') as HTMLInputElement).value = String(loc.lat);
            (form.elements.namedItem('geofenceLng') as HTMLInputElement).value = String(loc.lng);
          }}
        >
          <MapPin size={14} /> Use my current location
        </Button>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Latitude">
            <Input
              name="geofenceLat"
              type="number"
              step="0.000001"
              defaultValue={project.geofenceLat ?? ''}
            />
          </Field>
          <Field label="Longitude">
            <Input
              name="geofenceLng"
              type="number"
              step="0.000001"
              defaultValue={project.geofenceLng ?? ''}
            />
          </Field>
          <Field label="Radius (m)">
            <Input
              name="geofenceRadiusM"
              type="number"
              min="10"
              defaultValue={project.geofenceRadiusM ?? 150}
            />
          </Field>
        </div>
        {save.isSuccess && <p className="text-xs text-good-fg">Saved</p>}
        <Button type="submit" size="sm" disabled={save.isPending}>
          Save geofence
        </Button>
      </form>
    </details>
  );
}
