import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Fingerprint, Plus, RefreshCw, ScrollText } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type {
  AuditLogPage,
  CompanyProfile,
  InvoicingConfig,
  PipelineConfig,
  Project,
  Worker,
} from '@/lib/types';
import { fmtDate, fmtTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';

/** "worker.delete" -> "worker delete", "auth.login_failed" -> "auth login failed" */
function humanizeAction(action: string): string {
  const spaced = action
    .replace(/\./g, ' ')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

type DeviceVendor = 'ZKTECO' | 'SUPREMA';

interface Device {
  id: string;
  name: string;
  vendor: DeviceVendor;
  active: boolean;
  projectId: string | null;
  serialNumber: string | null;
  lastSyncAt: string | null;
  biostarBaseUrl: string | null;
  biostarLoginId: string | null;
  biostarDeviceId: string | null;
  biostarInsecureTls: boolean;
}

interface SyncIssue {
  id: string;
  biometricId: string;
  reason: 'unknown_worker' | 'no_assignment' | 'wrong_site' | string;
  occurrences: number;
  lastSeenAt: string;
  worker: { id: string; name: string; trade: string } | null;
}

const ISSUE_LABEL: Record<string, string> = {
  unknown_worker: 'Unrecognised fingerprint',
  no_assignment: 'Worker not assigned to a site',
  wrong_site: 'Punched at the wrong site',
  invalid_time: 'Invalid punch time',
};

type LabourSource = 'ATTENDANCE' | 'EXPENSES' | 'BOTH';

export function SettingsPage() {
  const qc = useQueryClient();
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [deviceVendor, setDeviceVendor] = useState<DeviceVendor>('ZKTECO');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [auditPage, setAuditPage] = useState(1);

  const { data: finance } = useQuery({
    queryKey: queryKeys.settings.finance(),
    queryFn: () =>
      api<{ thresholds: { yellowPct: number; redPct: number }; labourCostSource: LabourSource }>(
        '/settings/finance',
      ),
  });
  const { data: devices } = useQuery({
    queryKey: queryKeys.devices.all(),
    queryFn: () => api<Device[]>('/devices'),
  });
  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.all(),
    queryFn: () => api<Project[]>('/projects'),
  });
  const { data: auditLog, isLoading: auditLoading } = useQuery({
    queryKey: queryKeys.settings.auditLog(auditPage),
    queryFn: () => api<AuditLogPage>(`/settings/audit-log?page=${auditPage}`),
  });

  const saveLabourSource = useMutation({
    mutationFn: (labourCostSource: LabourSource) =>
      api('/settings/labour-source', { method: 'PUT', body: { labourCostSource } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings.finance() });
      void qc.invalidateQueries({ queryKey: queryKeys.analytics.all() });
    },
  });

  const bindDevice = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string | null }) =>
      api(`/devices/${id}`, { method: 'PATCH', body: { projectId } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.devices.all() }),
  });

  const createDevice = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ apiKey: string; vendor: DeviceVendor }>('/devices', { body }),
    onSuccess: (data) => {
      if (data.vendor === 'ZKTECO') setNewKey(data.apiKey);
      else setDeviceOpen(false); // Suprema needs no key handoff screen
      void qc.invalidateQueries({ queryKey: queryKeys.devices.all() });
    },
  });

  const toggleDevice = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/devices/${id}`, { method: 'PATCH', body: { active } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.devices.all() }),
  });

  const syncDevice = useMutation({
    mutationFn: (id: string) => api<{ received: number; accepted: number }>(`/devices/${id}/sync`, { body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.devices.all() }),
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.devices.syncIssues(),
    queryFn: () => api<SyncIssue[]>('/devices/issues'),
  });
  const { data: workers } = useQuery({
    queryKey: queryKeys.workers.all(),
    queryFn: () => api<Worker[]>('/workers'),
  });
  const invalidateIssues = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.devices.syncIssues() });
    void qc.invalidateQueries({ queryKey: queryKeys.workers.all() });
  };
  const resolveIssue = useMutation({
    mutationFn: (id: string) => api(`/devices/issues/${id}/resolve`, { method: 'POST' }),
    onSuccess: invalidateIssues,
  });
  const linkIssue = useMutation({
    mutationFn: ({ id, workerId }: { id: string; workerId: string }) =>
      api(`/devices/issues/${id}/link`, { method: 'POST', body: { workerId } }),
    onSuccess: invalidateIssues,
  });

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Settings"
        description="Budget rules, documents, attendance devices and the audit trail"
      />

      {/* Keyed on the stored thresholds so a save reseeds the inputs, rather
          than an effect overwriting them mid-edit. */}
      {finance && (
        <ThresholdsCard
          key={`${finance.thresholds.yellowPct}-${finance.thresholds.redPct}`}
          thresholds={finance.thresholds}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Labour cost source</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-fg-muted">
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

      <CompanyLetterheadCard />
      <InvoicingCard />
      <PipelineCard />

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
            <p className="text-sm text-fg-muted">
              No devices registered. Register a device to get its API key for attendance sync.
            </p>
          )}
          {devices?.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline p-3"
            >
              <div className="flex items-center gap-3">
                <Fingerprint size={18} className="text-brand-600" />
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-fg">{d.name}</p>
                    <Badge tone={d.vendor === 'SUPREMA' ? 'blue' : 'slate'}>
                      {d.vendor === 'SUPREMA' ? 'Suprema · BioStar 2' : 'ZKTeco'}
                    </Badge>
                  </div>
                  <p className="text-xs text-fg-subtle">
                    {d.serialNumber && (
                      <>
                        SN <span className="font-mono">{d.serialNumber}</span> ·{' '}
                      </>
                    )}
                    {d.vendor === 'SUPREMA' && d.biostarBaseUrl && (
                      <>
                        <span className="font-mono">{d.biostarBaseUrl}</span> ·{' '}
                      </>
                    )}
                    Last sync: {d.lastSyncAt ? fmtDate(d.lastSyncAt) : 'never'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {d.vendor === 'SUPREMA' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={syncDevice.isPending}
                    onClick={() => syncDevice.mutate(d.id)}
                  >
                    <RefreshCw size={14} /> Sync now
                  </Button>
                )}
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

      {issues && issues.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-600" />
              <CardTitle>Sync issues ({issues.length})</CardTitle>
            </div>
            <p className="text-xs text-fg-muted">
              Punches the system couldn&rsquo;t match to a worker. Link an unrecognised fingerprint
              to enrol that worker; future punches are then recorded automatically.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {issues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                workers={workers ?? []}
                onLink={(workerId) => linkIssue.mutate({ id: issue.id, workerId })}
                onDismiss={() => resolveIssue.mutate(issue.id)}
                busy={linkIssue.isPending || resolveIssue.isPending}
              />
            ))}
            {linkIssue.isError && (
              <p className="text-sm text-red-600">{(linkIssue.error as Error).message}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ScrollText size={16} className="text-fg-muted" />
            <CardTitle>Audit log</CardTitle>
          </div>
          <p className="text-xs text-fg-muted">
            Every create, update, and delete across the system, with who did it. Superadmin-only.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {auditLoading && <p className="text-sm text-fg-muted">Loading…</p>}
          {!auditLoading && auditLog?.items.length === 0 && (
            <Empty icon={ScrollText}>No activity recorded yet</Empty>
          )}
          <div className="divide-y divide-hairline">
            {auditLog?.items.map((entry) => {
              const actor = entry.user?.name ?? (entry.meta?.email as string | undefined) ?? 'Unknown';
              return (
                <div key={entry.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-fg">
                      <span className="font-medium">{actor}</span>
                      {entry.user && (
                        <Badge tone={entry.user.role === 'SUPERADMIN' ? 'blue' : 'slate'}>
                          {entry.user.role === 'SUPERADMIN' ? 'Admin' : 'Supervisor'}
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-fg-subtle">
                      {humanizeAction(entry.action)} · {entry.entity}
                    </p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-xs text-fg-subtle">
                    {fmtDate(entry.createdAt)} {fmtTime(entry.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
          {auditLog && (auditPage > 1 || auditLog.hasMore) && (
            <div className="flex items-center justify-between pt-1">
              <Button
                variant="outline"
                size="sm"
                disabled={auditPage <= 1}
                onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-xs text-fg-subtle">Page {auditPage}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={!auditLog.hasMore}
                onClick={() => setAuditPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={deviceOpen}
        onClose={() => {
          setDeviceOpen(false);
          setNewKey(null);
          setDeviceVendor('ZKTECO');
          createDevice.reset();
        }}
        title="Register attendance device"
      >
        {newKey ? (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              Device registered. Two ways to connect it:
            </p>
            <ul className="space-y-1.5 text-sm text-fg-muted">
              <li>
                <span className="font-medium text-fg">ZKTeco / ADMS terminal:</span> set its server
                address to this app&rsquo;s address (it will push to{' '}
                <code className="rounded bg-surface-sunken px-1 text-xs">/iclock</code>). It
                authenticates by the serial number you entered — no key needed.
              </li>
              <li>
                <span className="font-medium text-fg">Custom bridge:</span> POST batches to{' '}
                <code className="rounded bg-surface-sunken px-1 text-xs">/api/v1/attendance/device-sync</code>{' '}
                with header <code className="rounded bg-surface-sunken px-1 text-xs">X-Device-Key</code>{' '}
                set to the key below. Copy it now — it&rsquo;s shown only once.
              </li>
            </ul>
            <p className="break-all rounded-lg bg-slate-900 p-3 font-mono text-xs text-emerald-400">
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
            key={String(deviceVendor)}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              createDevice.mutate({
                name: fd.get('name'),
                vendor: deviceVendor,
                serialNumber: (fd.get('serialNumber') as string) || undefined,
                projectId: (fd.get('projectId') as string) || null,
                ...(deviceVendor === 'SUPREMA' && {
                  biostarBaseUrl: fd.get('biostarBaseUrl'),
                  biostarLoginId: fd.get('biostarLoginId'),
                  biostarPassword: fd.get('biostarPassword'),
                  biostarDeviceId: fd.get('biostarDeviceId') || undefined,
                  biostarInsecureTls: fd.get('biostarInsecureTls') === 'on',
                }),
              });
            }}
            className="space-y-3"
          >
            <Field label="Terminal make">
              <Select
                value={deviceVendor}
                onChange={(e) => setDeviceVendor(e.target.value as DeviceVendor)}
              >
                <option value="ZKTECO">ZKTeco / ADMS push terminal</option>
                <option value="SUPREMA">Suprema (BioLite Net, via BioStar 2)</option>
              </Select>
            </Field>
            <Field label="Device name">
              <Input name="name" required placeholder="Karen site — gate terminal" />
            </Field>

            {deviceVendor === 'ZKTECO' ? (
              <Field label="Serial number (printed on the device)">
                <Input name="serialNumber" placeholder="e.g. ZK9988" />
              </Field>
            ) : (
              <>
                <p className="rounded-lg bg-brand-50 p-3 text-xs text-brand-800">
                  A BioLite Net doesn&rsquo;t connect to this app directly — it reports into a
                  BioStar 2 server on your network, and this app polls that server for new
                  fingerprint events. Enter the BioStar 2 server&rsquo;s own login here (create a
                  read-only operator account for it if you&rsquo;d rather not share the admin
                  login).
                </p>
                <Field label="BioStar 2 server address">
                  <Input
                    name="biostarBaseUrl"
                    type="url"
                    required
                    placeholder="https://192.168.1.50"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Login ID">
                    <Input name="biostarLoginId" required />
                  </Field>
                  <Field label="Password">
                    <Input name="biostarPassword" type="password" required />
                  </Field>
                </div>
                <Field label="Device ID (optional — narrows to one terminal)">
                  <Input
                    name="biostarDeviceId"
                    placeholder="Leave blank to sync every terminal on this server"
                  />
                </Field>
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    name="biostarInsecureTls"
                    className="h-3.5 w-3.5 rounded border-hairline-strong accent-brand-600"
                  />
                  Skip certificate verification (self-signed BioStar 2 cert on your LAN)
                </label>
              </>
            )}

            <Field label="Bind to site (optional)">
              <Select name="projectId" defaultValue="">
                <option value="">Any site</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <FormError
              error={createDevice.error}
              fallback="Couldn’t register — is that serial number already in use?"
            />
            <Button type="submit" className="w-full" disabled={createDevice.isPending}>
              Register device
            </Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}

/**
 * The two percentages that decide whether a budget category reads healthy,
 * watch, or at risk. Its own component so the inputs seed from the saved
 * values on mount instead of via an effect.
 */
function ThresholdsCard({ thresholds }: { thresholds: { yellowPct: number; redPct: number } }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [yellowPct, setYellowPct] = useState(String(thresholds.yellowPct));
  const [redPct, setRedPct] = useState(String(thresholds.redPct));

  const save = useMutation({
    mutationFn: () =>
      api('/settings/thresholds', {
        method: 'PUT',
        body: { yellowPct: Number(yellowPct), redPct: Number(redPct) },
      }),
    onSuccess: () => {
      toast.success('Budget thresholds saved');
      void qc.invalidateQueries({ queryKey: queryKeys.settings.finance() });
      void qc.invalidateQueries({ queryKey: queryKeys.analytics.all() });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget health thresholds</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-fg-muted">
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
        <FormError error={save.error} fallback="Risk threshold must exceed watch threshold" />
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Save thresholds
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Letterhead for generated invoices and receipts. These are legal identifiers,
 * so they are entered here rather than guessed — an invoice without a correct
 * registered name and KRA PIN is not a valid tax invoice.
 */
function CompanyLetterheadCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: queryKeys.settings.company(),
    queryFn: () => api<CompanyProfile>('/settings/company'),
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/settings/company', { method: 'PUT', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.settings.company() }),
  });
  const uploadLogo = useMutation({
    mutationFn: (formData: FormData) => api('/settings/company/logo', { formData }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.settings.company() }),
  });

  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company letterhead</CardTitle>
        <p className="text-xs text-fg-muted">
          Printed on every invoice and receipt. Use the exact registered name and KRA PIN.
        </p>
      </CardHeader>
      <CardContent>
        <form
          key={data.name + (data.logoUrl ?? '')}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            save.mutate({
              name: fd.get('name'),
              addressLines: String(fd.get('addressLines') ?? '')
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean),
              phone: fd.get('phone'),
              email: fd.get('email'),
              kraPin: fd.get('kraPin'),
              vatRegistered: fd.get('vatRegistered') === 'on',
              bank: {
                name: fd.get('bankName'),
                branch: fd.get('bankBranch'),
                accountName: fd.get('accountName'),
                accountNo: fd.get('accountNo'),
                swift: fd.get('swift'),
                mpesaPaybill: fd.get('mpesaPaybill'),
              },
            });
          }}
          className="space-y-3"
        >
          <div className="flex items-center gap-4">
            {data.logoUrl ? (
              <img
                src={data.logoUrl}
                alt="Company logo"
                className="h-12 w-auto max-w-[9rem] object-contain"
              />
            ) : (
              <div className="flex h-12 w-24 items-center justify-center rounded-lg border border-dashed border-hairline-strong text-xs text-fg-subtle">
                No logo
              </div>
            )}
            <Field label="Replace logo">
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const fd = new FormData();
                  fd.append('logo', file);
                  uploadLogo.mutate(fd);
                }}
              />
            </Field>
          </div>
          <FormError error={uploadLogo.error} fallback="Failed to upload the logo" />

          <Field label="Registered name">
            <Input name="name" defaultValue={data.name} required />
          </Field>
          <Field label="Address (one line per row)">
            <Textarea name="addressLines" defaultValue={data.addressLines.join('\n')} rows={3} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone">
              <Input name="phone" defaultValue={data.phone} />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" defaultValue={data.email} />
            </Field>
            <Field label="KRA PIN">
              <Input name="kraPin" defaultValue={data.kraPin} placeholder="P051XXXXXXX" />
            </Field>
            <label className="flex items-end gap-2 pb-2.5 text-sm text-fg">
              <input
                type="checkbox"
                name="vatRegistered"
                defaultChecked={data.vatRegistered}
                className="h-4 w-4 rounded border-hairline-strong accent-brand-600"
              />
              VAT registered
            </label>
          </div>

          <p className="pt-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">
            Bank details shown on invoices
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bank">
              <Input name="bankName" defaultValue={data.bank.name} />
            </Field>
            <Field label="Branch">
              <Input name="bankBranch" defaultValue={data.bank.branch} />
            </Field>
            <Field label="Account name">
              <Input name="accountName" defaultValue={data.bank.accountName} />
            </Field>
            <Field label="Account number">
              <Input name="accountNo" defaultValue={data.bank.accountNo} />
            </Field>
            <Field label="SWIFT">
              <Input name="swift" defaultValue={data.bank.swift} />
            </Field>
            <Field label="M-Pesa paybill">
              <Input name="mpesaPaybill" defaultValue={data.bank.mpesaPaybill} />
            </Field>
          </div>

          {save.isSuccess && <p className="text-sm text-green-700">Saved</p>}
          <FormError error={save.error} fallback="Failed to save" />
          <Button type="submit" disabled={save.isPending}>
            Save letterhead
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PipelineCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: queryKeys.settings.pipeline(),
    queryFn: () => api<PipelineConfig>('/settings/pipeline'),
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/settings/pipeline', { method: 'PUT', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings.pipeline() });
      void qc.invalidateQueries({ queryKey: queryKeys.settings.quotationDefaults() });
    },
  });

  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quotations &amp; contracts</CardTitle>
        <p className="text-xs text-fg-muted">
          Numbering and the standard wording. Editing the conditions here changes what prints on
          contracts issued from now on — documents already issued keep the wording they went out
          with.
        </p>
      </CardHeader>
      <CardContent>
        <form
          key={data.quotationPrefix + data.quotationValidityDays}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            save.mutate({
              quotationPrefix: fd.get('quotationPrefix'),
              contractPrefix: fd.get('contractPrefix'),
              projectPrefix: fd.get('projectPrefix'),
              quotationValidityDays: Number(fd.get('quotationValidityDays')),
              quotationTermsText: fd.get('quotationTermsText'),
              contractTermsText: fd.get('contractTermsText'),
            });
          }}
          className="space-y-3"
        >
          <dl className="grid grid-cols-3 gap-3 rounded-lg border border-hairline bg-surface-muted/40 p-3 text-sm">
            {[
              ['Next quotation', data.nextQuotationNo],
              ['Next contract', data.nextContractNo],
              ['Next project code', data.nextProjectCode],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-fg-subtle">{label}</dt>
                <dd className="font-medium nums text-fg">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Quotation prefix">
              <Input name="quotationPrefix" defaultValue={data.quotationPrefix} required />
            </Field>
            <Field label="Contract prefix">
              <Input name="contractPrefix" defaultValue={data.contractPrefix} required />
            </Field>
            <Field label="Project prefix">
              <Input name="projectPrefix" defaultValue={data.projectPrefix} required />
            </Field>
            <Field label="Valid for (days)">
              <Input
                name="quotationValidityDays"
                type="number"
                min="1"
                max="365"
                defaultValue={data.quotationValidityDays}
                required
              />
            </Field>
          </div>

          <Field label="Standard quotation terms">
            <Textarea name="quotationTermsText" rows={4} defaultValue={data.quotationTermsText} />
          </Field>
          <p className="-mt-2 text-xs text-fg-subtle">
            One condition per line — each prints as a bullet.
          </p>

          <Field label="Conditions of contract">
            <Textarea name="contractTermsText" rows={10} defaultValue={data.contractTermsText} />
          </Field>
          <p className="-mt-2 text-xs text-fg-subtle">
            Leave a blank line between clauses. These are a starting point, not legal advice — have
            them reviewed before you rely on them.
          </p>

          {save.isSuccess && <p className="text-sm text-green-700">Saved</p>}
          {save.isError && <p className="text-sm text-red-600">Couldn&rsquo;t save those settings</p>}
          <Button type="submit" disabled={save.isPending}>
            Save quotation &amp; contract settings
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function InvoicingCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: queryKeys.settings.invoicing(),
    queryFn: () => api<InvoicingConfig>('/settings/invoicing'),
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/settings/invoicing', { method: 'PUT', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.settings.invoicing() }),
  });

  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoicing</CardTitle>
        <p className="text-xs text-fg-muted">
          Numbering and the defaults applied to a new invoice. Changing a rate here never re-totals
          an invoice that has already been issued.
        </p>
      </CardHeader>
      <CardContent>
        <form
          key={data.invoicePrefix + data.vatRatePct}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const start = String(fd.get('startNumber') ?? '').trim();
            save.mutate({
              invoicePrefix: fd.get('invoicePrefix'),
              receiptPrefix: fd.get('receiptPrefix'),
              numberPadding: Number(fd.get('numberPadding')),
              vatRatePct: Number(fd.get('vatRatePct')),
              defaultRetentionPct: Number(fd.get('defaultRetentionPct')),
              defaultPaymentTermsDays: Number(fd.get('defaultPaymentTermsDays')),
              footerNote: fd.get('footerNote'),
              ...(start ? { startNumber: Number(start) } : {}),
            });
          }}
          className="space-y-3"
        >
          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-hairline bg-surface-muted/40 p-3 text-sm">
            <div>
              <dt className="text-xs text-fg-subtle">Next invoice number</dt>
              <dd className="font-medium nums text-fg">{data.nextInvoiceNo}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-subtle">Next receipt number</dt>
              <dd className="font-medium nums text-fg">{data.nextReceiptNo}</dd>
            </div>
          </dl>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Invoice prefix">
              <Input name="invoicePrefix" defaultValue={data.invoicePrefix} required />
            </Field>
            <Field label="Receipt prefix">
              <Input name="receiptPrefix" defaultValue={data.receiptPrefix} required />
            </Field>
            <Field label="Digits">
              <Input
                name="numberPadding"
                type="number"
                min="3"
                max="10"
                defaultValue={data.numberPadding}
                required
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="VAT rate (%)">
              <Input
                name="vatRatePct"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={data.vatRatePct}
                required
              />
            </Field>
            <Field label="Default retention (%)">
              <Input
                name="defaultRetentionPct"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={data.defaultRetentionPct}
                required
              />
            </Field>
            <Field label="Payment terms (days)">
              <Input
                name="defaultPaymentTermsDays"
                type="number"
                min="0"
                max="365"
                defaultValue={data.defaultPaymentTermsDays}
                required
              />
            </Field>
          </div>

          <Field label="Invoice footer note">
            <Textarea
              name="footerNote"
              defaultValue={data.footerNote}
              rows={2}
              placeholder="e.g. Payment due within 30 days."
            />
          </Field>

          <Field label="Continue an existing series from (optional)">
            <Input
              name="startNumber"
              type="number"
              min="1"
              placeholder="Leave blank to keep counting from where the system is"
            />
          </Field>

          {save.isSuccess && <p className="text-sm text-green-700">Saved</p>}
          <FormError error={save.error} fallback="Failed to save" />
          <Button type="submit" disabled={save.isPending}>
            Save invoicing settings
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function IssueRow({
  issue,
  workers,
  onLink,
  onDismiss,
  busy,
}: {
  issue: SyncIssue;
  workers: Worker[];
  onLink: (workerId: string) => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const [workerId, setWorkerId] = useState('');
  const isUnknown = issue.reason === 'unknown_worker';
  return (
    <div className="rounded-lg border border-hairline p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">{ISSUE_LABEL[issue.reason] ?? issue.reason}</p>
          <p className="text-xs text-fg-subtle">
            {isUnknown ? (
              <>
                Fingerprint <span className="font-mono text-fg-muted">{issue.biometricId}</span>
              </>
            ) : (
              (issue.worker?.name ?? 'Unknown worker')
            )}{' '}
            · seen {issue.occurrences}× · last {fmtDate(issue.lastSeenAt)}
          </p>
        </div>
        {!isUnknown && (
          <Button size="sm" variant="outline" onClick={onDismiss} disabled={busy}>
            Dismiss
          </Button>
        )}
      </div>
      {isUnknown && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Combobox
            value={workerId}
            onChange={setWorkerId}
            placeholder="Link to worker…"
            className="h-9 w-56 text-xs"
            aria-label="Link fingerprint to worker"
            options={workers.map((w) => ({ value: w.id, label: `${w.name} · ${w.trade}` }))}
          />
          <Button size="sm" disabled={!workerId || busy} onClick={() => onLink(workerId)}>
            Link &amp; enrol
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
