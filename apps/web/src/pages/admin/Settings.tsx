import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import type { Project } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface Device {
  id: string;
  name: string;
  active: boolean;
  projectId: string | null;
  lastSyncAt: string | null;
}

type LabourSource = 'ATTENDANCE' | 'EXPENSES' | 'BOTH';

export function SettingsPage() {
  const qc = useQueryClient();
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [yellowPct, setYellowPct] = useState('80');
  const [redPct, setRedPct] = useState('100');

  const { data: finance } = useQuery({
    queryKey: ['finance-settings'],
    queryFn: () =>
      api<{ thresholds: { yellowPct: number; redPct: number }; labourCostSource: LabourSource }>(
        '/settings/finance',
      ),
  });
  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: () => api<Device[]>('/devices'),
  });
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
  });

  useEffect(() => {
    if (finance) {
      setYellowPct(String(finance.thresholds.yellowPct));
      setRedPct(String(finance.thresholds.redPct));
    }
  }, [finance]);

  const saveThresholds = useMutation({
    mutationFn: () =>
      api('/settings/thresholds', {
        method: 'PUT',
        body: { yellowPct: Number(yellowPct), redPct: Number(redPct) },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance-settings'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  const saveLabourSource = useMutation({
    mutationFn: (labourCostSource: LabourSource) =>
      api('/settings/labour-source', { method: 'PUT', body: { labourCostSource } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance-settings'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  const bindDevice = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string | null }) =>
      api(`/devices/${id}`, { method: 'PATCH', body: { projectId } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['devices'] }),
  });

  const createDevice = useMutation({
    mutationFn: (name: string) => api<{ apiKey: string }>('/devices', { body: { name } }),
    onSuccess: (data) => {
      setNewKey(data.apiKey);
      void qc.invalidateQueries({ queryKey: ['devices'] });
    },
  });

  const toggleDevice = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/devices/${id}`, { method: 'PATCH', body: { active } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['devices'] }),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Budget health thresholds</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-500">
            A category is <Badge tone="green">Healthy</Badge> below the watch threshold,{' '}
            <Badge tone="yellow">Watch</Badge> once consumption reaches it, and{' '}
            <Badge tone="red">At risk</Badge> at the risk threshold.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Watch threshold (%)">
              <Input
                type="number"
                min="1"
                max="200"
                value={yellowPct}
                onChange={(e) => setYellowPct(e.target.value)}
              />
            </Field>
            <Field label="Risk threshold (%)">
              <Input
                type="number"
                min="1"
                max="300"
                value={redPct}
                onChange={(e) => setRedPct(e.target.value)}
              />
            </Field>
          </div>
          {saveThresholds.isSuccess && <p className="text-sm text-green-700">Saved</p>}
          {saveThresholds.isError && (
            <p className="text-sm text-red-600">Risk threshold must exceed watch threshold</p>
          )}
          <Button onClick={() => saveThresholds.mutate()} disabled={saveThresholds.isPending}>
            Save thresholds
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Labour cost source</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-500">
            Prevents double-counting wages. Choose where LABOUR actuals come from: biometric
            attendance (recommended once devices are live), labour expense entries, or both
            (conservative — may overstate costs if wages appear in both places).
          </p>
          <Select
            value={finance?.labourCostSource ?? 'BOTH'}
            onChange={(e) => saveLabourSource.mutate(e.target.value as LabourSource)}
            className="max-w-sm"
            aria-label="Labour cost source"
          >
            <option value="ATTENDANCE">Biometric attendance only</option>
            <option value="EXPENSES">Labour expenses only</option>
            <option value="BOTH">Both (may double-count)</option>
          </Select>
          {saveLabourSource.isSuccess && <p className="text-sm text-green-700">Saved</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Fingerprint attendance devices</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setDeviceOpen(true)}>
              <Plus size={14} /> Register device
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {devices?.length === 0 && (
            <p className="text-sm text-slate-500">
              No devices registered. Register a device to get its API key for attendance sync.
            </p>
          )}
          {devices?.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3"
            >
              <div className="flex items-center gap-3">
                <Fingerprint size={18} className="text-brand-600" />
                <div>
                  <p className="text-sm font-medium text-slate-900">{d.name}</p>
                  <p className="text-xs text-slate-500">
                    Last sync: {d.lastSyncAt ? fmtDate(d.lastSyncAt) : 'never'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={d.projectId ?? ''}
                  onChange={(e) =>
                    bindDevice.mutate({ id: d.id, projectId: e.target.value || null })
                  }
                  className="h-9 w-40 text-xs"
                  aria-label={`Site binding for ${d.name}`}
                >
                  <option value="">Any site</option>
                  {projects?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Badge tone={d.active ? 'green' : 'red'}>{d.active ? 'Active' : 'Disabled'}</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggleDevice.mutate({ id: d.id, active: !d.active })}
                >
                  {d.active ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog
        open={deviceOpen}
        onClose={() => {
          setDeviceOpen(false);
          setNewKey(null);
        }}
        title="Register attendance device"
      >
        {newKey ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              Device registered. Copy this API key now — it is shown only once. Configure the
              device (or its sync bridge) to send batches to{' '}
              <code className="rounded bg-slate-100 px-1">POST /api/v1/attendance/device-sync</code>{' '}
              with header <code className="rounded bg-slate-100 px-1">X-Device-Key</code>.
            </p>
            <p className="break-all rounded-lg bg-slate-900 p-3 font-mono text-xs text-green-400">
              {newKey}
            </p>
            <Button
              className="w-full"
              onClick={() => {
                setDeviceOpen(false);
                setNewKey(null);
              }}
            >
              Done
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              createDevice.mutate(fd.get('name') as string);
            }}
            className="space-y-3"
          >
            <Field label="Device name">
              <Input name="name" required placeholder="Karen site — device 1" />
            </Field>
            <Button type="submit" className="w-full" disabled={createDevice.isPending}>
              Register & generate API key
            </Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}
