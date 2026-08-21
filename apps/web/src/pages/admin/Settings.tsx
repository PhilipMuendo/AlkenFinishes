import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Fingerprint, Plus, RefreshCw, ScrollText } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type {
  AiSettings,
  AuditLogPage,
  CompanyProfile,
  InvoicingConfig,
  PipelineConfig,
  Project,
  PayeBand,
  PayrollConfig,
  PurchaseTaxConfig,
  StaffTaxConfig,
  Worker,
} from '@/lib/types';
import { fmtDate, fmtTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Badge } from '@/components/ui/badge';
import { QueryState } from '@/components/ui/query-state';
import { Empty } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { PageHeader } from '@/components/ui/page-header';
import { toast } from '@/components/ui/toast';

/**
 * Nine configuration cards in one column meant scrolling past the company
 * letterhead to reach a PAYE band. These are the same grouped tabs
 * ProjectDetail uses, and for the same reason — with the id in the URL,
 * /admin/settings/payroll is a link you can send someone.
 */
const SECTIONS = [
  { id: 'company', label: 'Company' },
  { id: 'documents', label: 'Documents' },
  { id: 'money', label: 'Money & tax' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'audit', label: 'Audit log' },
] as const;

const SECTION_IDS = new Set<string>(SECTIONS.map((s) => s.id));

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
  const navigate = useNavigate();
  const { section: requested } = useParams();
  const section = requested && SECTION_IDS.has(requested) ? requested : 'company';

  const [deviceOpen, setDeviceOpen] = useState(false);
  const [deviceVendor, setDeviceVendor] = useState<DeviceVendor>('ZKTECO');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [yellowPct, setYellowPct] = useState('80');
  const [redPct, setRedPct] = useState('100');
  const [auditPage, setAuditPage] = useState(1);

  // Each section fetches only what it shows. The audit log in particular is a
  // paged query that has no business running while someone edits a letterhead.
  const { data: finance } = useQuery({
    queryKey: ['finance-settings'],
    queryFn: () =>
      api<{ thresholds: { yellowPct: number; redPct: number }; labourCostSource: LabourSource }>(
        '/settings/finance',
      ),
    enabled: section === 'money',
  });
  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: () => api<Device[]>('/devices'),
    enabled: section === 'attendance',
  });
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
    enabled: section === 'attendance',
  });
  const { data: auditLog, isLoading: auditLoading } = useQuery({
    queryKey: ['audit-log', auditPage],
    queryFn: () => api<AuditLogPage>(`/settings/audit-log?page=${auditPage}`),
    enabled: section === 'audit',
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
      toast.success('Budget thresholds saved. Site health is judged against them from now on.');
      void qc.invalidateQueries({ queryKey: ['finance-settings'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (e) => toast.error(errText(e, 'The thresholds were not saved.')),
  });

  const saveLabourSource = useMutation({
    mutationFn: (labourCostSource: LabourSource) =>
      api('/settings/labour-source', { method: 'PUT', body: { labourCostSource } }),
    onSuccess: () => {
      toast.success('Labour cost source saved. Every site total is recalculated from it.');
      void qc.invalidateQueries({ queryKey: ['finance-settings'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (e) => toast.error(errText(e, 'The setting was not saved.')),
  });

  const bindDevice = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string | null }) =>
      api(`/devices/${id}`, { method: 'PATCH', body: { projectId } }),
    onSuccess: () => {
      toast.success('Device bound to the site.');
      void qc.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (e) => toast.error(errText(e, 'The device was not bound.')),
  });

  const createDevice = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ apiKey: string; vendor: DeviceVendor }>('/devices', { body }),
    onSuccess: (data) => {
      if (data.vendor === 'ZKTECO') setNewKey(data.apiKey);
      else setDeviceOpen(false); // Suprema needs no key handoff screen
      void qc.invalidateQueries({ queryKey: ['devices'] });
    },
  });

  const toggleDevice = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/devices/${id}`, { method: 'PATCH', body: { active } }),
    onSuccess: (_r, vars) => {
      toast.success(vars.active ? 'Device switched on.' : 'Device switched off.');
      void qc.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (e) => toast.error(errText(e, 'The device was not updated.')),
  });

  const syncDevice = useMutation({
    mutationFn: (id: string) => api<{ received: number; accepted: number }>(`/devices/${id}/sync`, { body: {} }),
    onSuccess: (r) => {
      // Received and accepted differ whenever a punch could not be matched to
      // a fundi, and that gap is the whole reason to look at this screen.
      toast.success(
        r.received === r.accepted
          ? `${r.accepted} punches synced.`
          : `${r.accepted} of ${r.received} punches synced — the rest are listed under sync issues.`,
      );
      void qc.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (e) => toast.error(errText(e, 'The device could not be synced.')),
  });

  const { data: issues } = useQuery({
    queryKey: ['sync-issues'],
    queryFn: () => api<SyncIssue[]>('/devices/issues'),
    enabled: section === 'attendance',
  });
  const { data: workers } = useQuery({
    queryKey: ['workers'],
    queryFn: () => api<Worker[]>('/workers'),
    enabled: section === 'attendance',
  });
  const invalidateIssues = () => {
    void qc.invalidateQueries({ queryKey: ['sync-issues'] });
    void qc.invalidateQueries({ queryKey: ['workers'] });
  };
  const resolveIssue = useMutation({
    mutationFn: (id: string) => api(`/devices/issues/${id}/resolve`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Issue dismissed.');
      invalidateIssues();
    },
    onError: (e) => toast.error(errText(e, 'The issue was not dismissed.')),
  });
  const linkIssue = useMutation({
    mutationFn: ({ id, workerId }: { id: string; workerId: string }) =>
      api(`/devices/issues/${id}/link`, { method: 'POST', body: { workerId } }),
    onSuccess: () => {
      toast.success('Fingerprint enrolled. Future punches will be recorded automatically.');
      invalidateIssues();
    },
    onError: (e) => toast.error(errText(e, 'The fingerprint was not enrolled.')),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Settings"
        description="Budget rules, documents, attendance devices and the audit trail"
      />

      <Tabs
        tabs={SECTIONS.map((s) => ({ id: s.id, label: s.label }))}
        active={section}
        onChange={(id) => navigate(`/admin/settings/${id}`)}
      />

      {section === 'company' && <CompanyLetterheadCard />}

      {section === 'documents' && (
        <>
          <InvoicingCard />
          <PipelineCard />
        </>
      )}

      {section === 'money' && (
        <>
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
              {saveThresholds.isError && (
                <p className="text-sm text-danger-fg">Risk threshold must exceed watch threshold</p>
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
            </CardContent>
          </Card>

          <PurchaseTaxCard />
          <StaffTaxCard />
          <PayrollCard />
        </>
      )}

      {section === 'attendance' && (
        <>
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
                  <AlertTriangle size={16} className="text-warn-fg" />
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
                  <p className="text-sm text-danger-fg">{(linkIssue.error as Error).message}</p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {section === 'assistant' && <AssistantCard />}

      {section === 'audit' && (
        <>
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
                <Empty variant="inline" icon={ScrollText}>No activity recorded yet</Empty>
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
        </>
      )}

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
            {createDevice.isError && (
              <p className="text-sm text-danger-fg">
                {createDevice.error instanceof ApiRequestError
                  ? createDevice.error.message
                  : "Couldn't register — is that serial number already in use?"}
              </p>
            )}
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
 * How much of the day's free allowance the assistant may spend.
 *
 * All three AI features share one key and therefore one daily cap. Without a
 * reserve the assistant — much the hungriest of them — would quietly eat the
 * allowance and the receipt reader would stop working by mid-morning with
 * nothing to explain why. Today's counts are shown beside the setting so the
 * reserve can be sized from what actually happens here.
 */
function AssistantCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['settings', 'ai'],
    queryFn: () => api<AiSettings>('/settings/ai'),
  });

  const [dailyCalls, setDailyCalls] = useState('');
  const [reserved, setReserved] = useState('');
  useEffect(() => {
    if (data) {
      setDailyCalls(String(data.budget.dailyCalls));
      setReserved(String(data.budget.reservedForWork));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/settings/ai', { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('Assistant allowance saved.');
      void qc.invalidateQueries({ queryKey: ['settings', 'ai'] });
      void qc.invalidateQueries({ queryKey: ['chat', 'status'] });
    },
    onError: (e) => toast.error(errText(e, 'The allowance was not saved.')),
  });

  if (!data) return <Card><CardContent className="pt-5 text-sm text-fg-muted">Loading…</CardContent></Card>;

  if (!data.available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Assistant</CardTitle>
          <p className="text-xs text-fg-muted">
            No AI key is configured, so receipt reading, report drafting and the assistant are all
            switched off. Every form works by hand exactly as before.
          </p>
        </CardHeader>
      </Card>
    );
  }

  const chatCeiling = Math.max(0, data.budget.dailyCalls - data.budget.reservedForWork);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assistant allowance</CardTitle>
        <p className="text-xs text-fg-muted">
          Reading receipts, drafting site reports and answering questions all draw on the same
          free daily allowance. The assistant stops early so the other two keep working.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-hairline bg-surface-muted p-3">
          <p className="text-xs font-medium text-fg-muted">Used today ({data.usage.day})</p>
          <p className="mt-1 text-sm text-fg">
            <span className="font-semibold tabular-nums">{data.used}</span> of{' '}
            <span className="tabular-nums">{data.budget.dailyCalls}</span> — {data.usage.receipt}{' '}
            receipts, {data.usage.report} reports, {data.usage.chat} questions.
          </p>
          <p className="mt-1 text-xs text-fg-subtle">
            {data.chat.allowed
              ? `The assistant has ${data.chat.remaining} left before it yields.`
              : 'The assistant has stopped for today; receipts and reports still work.'}
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ dailyCalls: Number(dailyCalls), reservedForWork: Number(reserved) });
          }}
          className="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Requests a day your key allows">
              <Input
                type="number"
                min="1"
                inputMode="numeric"
                value={dailyCalls}
                onChange={(e) => setDailyCalls(e.target.value)}
                required
              />
            </Field>
            <Field label="Held back for receipts and reports">
              <Input
                type="number"
                min="0"
                inputMode="numeric"
                value={reserved}
                onChange={(e) => setReserved(e.target.value)}
                required
              />
            </Field>
          </div>
          <p className="text-xs text-fg-subtle">
            The assistant may use {chatCeiling} request{chatCeiling === 1 ? '' : 's'} a day; the
            remaining {data.budget.reservedForWork} are kept for the work the business depends on.
          </p>
          <Button type="submit" disabled={save.isPending}>
            Save
          </Button>
        </form>
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
  const query = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => api<CompanyProfile>('/settings/company'),
  });
  const { data } = query;

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/settings/company', { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('Letterhead saved. New invoices and receipts will carry it.');
      void qc.invalidateQueries({ queryKey: ['settings', 'company'] });
    },
    onError: (e) => toast.error(errText(e, 'The letterhead was not saved.')),
  });
  const uploadLogo = useMutation({
    mutationFn: (formData: FormData) => api('/settings/company/logo', { formData }),
    onSuccess: () => {
      toast.success('Logo uploaded.');
      void qc.invalidateQueries({ queryKey: ['settings', 'company'] });
    },
    onError: (e) => toast.error(errText(e, 'The logo was not uploaded.')),
  });

  if (!data) return <QueryState query={query} rows={2} noun="these settings" />;

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
          {uploadLogo.isError && (
            <p className="text-sm text-danger-fg">
              {uploadLogo.error instanceof ApiRequestError
                ? uploadLogo.error.message
                : 'Failed to upload the logo'}
            </p>
          )}

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

          {save.isError && (
            <p className="text-sm text-danger-fg">
              {save.error instanceof ApiRequestError ? save.error.message : 'Failed to save'}
            </p>
          )}
          <Button type="submit" disabled={save.isPending}>
            Save letterhead
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Tax on what we buy.
 *
 * Rates are settings rather than constants because they change by finance act
 * and differ by what is being bought. Withholding is off until it is switched
 * on here, so nothing is ever deducted from a supplier by accident.
 */
function PurchaseTaxCard() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['settings', 'purchase-tax'],
    queryFn: () => api<PurchaseTaxConfig>('/settings/purchase-tax'),
  });
  const { data } = query;
  const [agent, setAgent] = useState<boolean | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/settings/purchase-tax', { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('Purchase tax settings saved.');
      void qc.invalidateQueries({ queryKey: ['settings', 'purchase-tax'] });
    },
    onError: (e) => toast.error(errText(e, 'The settings were not saved.')),
  });

  if (!data) return <QueryState query={query} rows={2} noun="these settings" />;
  const isAgent = agent ?? data.withholdingAgent;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax on purchases</CardTitle>
        <p className="text-xs text-fg-muted">
          How supplier bills and payments are taxed. These figures are yours to set — they change
          by finance act and differ by what is bought, so nothing here is assumed on your behalf.
        </p>
      </CardHeader>
      <CardContent>
        <form
          key={String(data.withholdingAgent) + data.vatRatePct}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            save.mutate({
              vatRatePct: Number(fd.get('vatRatePct')),
              billsIncludeVat: fd.get('billsIncludeVat') === 'true',
              withholdingAgent: isAgent,
              // Rates are meaningless unless we actually withhold, and leaving
              // a stale rate behind a switched-off flag is how it gets applied
              // by surprise later.
              defaultWhtRatePct: isAgent ? Number(fd.get('defaultWhtRatePct')) : 0,
              defaultWhtVatRatePct: isAgent ? Number(fd.get('defaultWhtVatRatePct')) : 0,
            });
          }}
          className="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Standard input VAT rate %">
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
            <Field label="Supplier figures are normally typed">
              <Select name="billsIncludeVat" defaultValue={String(data.billsIncludeVat)}>
                <option value="true">VAT inclusive</option>
                <option value="false">VAT exclusive</option>
              </Select>
            </Field>
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-hairline p-3 text-sm">
            <input
              type="checkbox"
              checked={isAgent}
              onChange={(e) => setAgent(e.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="font-medium text-fg">
                We are an appointed withholding agent
              </span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                Leave this off unless KRA has appointed you. When off, no tax is ever suggested
                for deduction from a supplier payment.
              </span>
            </span>
          </label>

          {isAgent && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Default withholding tax %">
                <Input
                  name="defaultWhtRatePct"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={data.defaultWhtRatePct}
                />
              </Field>
              <Field label="Default withholding VAT %">
                <Input
                  name="defaultWhtVatRatePct"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={data.defaultWhtVatRatePct}
                />
              </Field>
              <p className="text-xs text-fg-subtle sm:col-span-2">
                Both are struck on the VAT-exclusive value of a supply. Every payment still shows
                the figure before it is saved, and it can be overridden.
              </p>
            </div>
          )}

          {save.isError && (
            <p className="text-sm text-danger-fg">
              {save.error instanceof ApiRequestError ? save.error.message : 'Failed to save'}
            </p>
          )}
          <Button type="submit" disabled={save.isPending}>
            Save tax settings
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Tax on what we pay casual/contracted staff.
 *
 * Its own rate, not shared with purchase tax: a supplier's withholding rate
 * and a fundi's are not the same fact about the company. For staff run
 * through formal Payroll (see below), this does not apply — PAYE and
 * withholding are alternative treatments of the same income, never both.
 */
function StaffTaxCard() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['settings', 'staff-tax'],
    queryFn: () => api<StaffTaxConfig>('/settings/staff-tax'),
  });
  const { data } = query;
  const [agent, setAgent] = useState<boolean | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/settings/staff-tax', { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('Staff tax settings saved.');
      void qc.invalidateQueries({ queryKey: ['settings', 'staff-tax'] });
    },
    onError: (e) => toast.error(errText(e, 'The settings were not saved.')),
  });

  if (!data) return <QueryState query={query} rows={2} noun="these settings" />;
  const isAgent = agent ?? data.withholdingAgent;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax on staff payments</CardTitle>
        <p className="text-xs text-fg-muted">
          For fundis paid for hours worked rather than employed on PAYE terms — the Fundis screen
          suggests this rate when you record a payment, and it can be overridden.
        </p>
      </CardHeader>
      <CardContent>
        <form
          key={String(data.withholdingAgent) + data.defaultWhtRatePct}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            save.mutate({
              withholdingAgent: isAgent,
              // A rate behind a switched-off flag is how it gets applied by
              // surprise later, so it is zeroed rather than kept stale.
              defaultWhtRatePct: isAgent ? Number(fd.get('defaultWhtRatePct')) : 0,
            });
          }}
          className="space-y-3"
        >
          <label className="flex items-start gap-2.5 rounded-lg border border-hairline p-3 text-sm">
            <input
              type="checkbox"
              checked={isAgent}
              onChange={(e) => setAgent(e.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="font-medium text-fg">We withhold tax from staff payments</span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                Leave this off unless you actually withhold. When off, no tax is ever suggested
                for deduction from a fundi payment.
              </span>
            </span>
          </label>

          {isAgent && (
            <Field label="Default withholding tax %">
              <Input
                name="defaultWhtRatePct"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={data.defaultWhtRatePct}
              />
            </Field>
          )}

          {save.isError && (
            <p className="text-sm text-danger-fg">
              {save.error instanceof ApiRequestError ? save.error.message : 'Failed to save'}
            </p>
          )}
          <Button type="submit" disabled={save.isPending}>
            Save tax settings
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Statutory deductions on wages.
 *
 * Every figure is the user's. The software applies them consistently and in
 * the right order; it does not decide what the law requires, and it says so.
 */
function PayrollCard() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['settings', 'payroll'],
    queryFn: () => api<PayrollConfig>('/settings/payroll'),
  });
  const { data } = query;
  const [bands, setBands] = useState<PayeBand[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/settings/payroll', { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('Payroll rates saved. They apply to runs created from now on.');
      void qc.invalidateQueries({ queryKey: ['settings', 'payroll'] });
    },
    onError: (e) => toast.error(errText(e, 'The rates were not saved.')),
  });

  if (!data) return <QueryState query={query} rows={2} noun="these settings" />;
  const rows = bands ?? data.payeBands;
  const on = enabled ?? data.enabled;

  const setBand = (i: number, patch: Partial<PayeBand>) =>
    setBands(rows.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payroll deductions</CardTitle>
        <p className="text-xs text-fg-muted">
          PAYE bands, relief, NSSF, SHIF and the housing levy. These are yours to set and check —
          they change by finance act and by the nature of the engagement. Nothing is deducted from
          anybody until you switch this on.
        </p>
      </CardHeader>
      <CardContent>
        <form
          key={String(data.enabled) + data.payeBands.length}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            save.mutate({
              enabled: on,
              payeBands: rows,
              personalReliefPerMonth: Number(fd.get('personalReliefPerMonth')),
              nssfTiers: data.nssfTiers,
              shifRatePct: Number(fd.get('shifRatePct')),
              shifMinimum: Number(fd.get('shifMinimum')),
              housingLevyEmployeePct: Number(fd.get('housingLevyEmployeePct')),
              housingLevyEmployerPct: Number(fd.get('housingLevyEmployerPct')),
            });
          }}
          className="space-y-3"
        >
          <label className="flex items-start gap-2.5 rounded-lg border border-hairline p-3 text-sm">
            <input
              type="checkbox"
              checked={on}
              onChange={(e) => setEnabled(e.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="font-medium text-fg">Apply statutory deductions</span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                Off means every fundi is paid their full wage and nothing is withheld — which is
                what a company paying casuals in cash and filing nothing should see.
              </span>
            </span>
          </label>

          {on && (
            <>
              <div>
                <p className="mb-1.5 text-xs font-medium text-fg-muted">
                  PAYE bands — each rate applies only to the pay inside that band
                </p>
                <div className="space-y-2">
                  {rows.map((b, i) => (
                    <div key={i} className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[9rem] flex-1">
                        <Field label={i === 0 ? 'Up to' : 'Then up to'}>
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            value={b.upTo ?? ''}
                            placeholder="and above"
                            onChange={(e) =>
                              setBand(i, {
                                upTo: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                      </div>
                      <div className="w-28">
                        <Field label="Rate %">
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={b.ratePct}
                            onChange={(e) => setBand(i, { ratePct: Number(e.target.value) })}
                          />
                        </Field>
                      </div>
                      {rows.length > 1 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setBands(rows.filter((_, j) => j !== i))}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => setBands([...rows, { upTo: null, ratePct: 30 }])}
                >
                  Add band
                </Button>
                <p className="mt-1.5 text-xs text-fg-subtle">
                  Leave the last band&rsquo;s ceiling blank so it covers everything above.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Personal relief per month" hint="Credited against the tax, not pay">
                  <Input
                    name="personalReliefPerMonth"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={data.personalReliefPerMonth}
                  />
                </Field>
                <Field label="SHIF rate %">
                  <Input
                    name="shifRatePct"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={data.shifRatePct}
                  />
                </Field>
                <Field label="SHIF minimum" hint="Zero for no floor">
                  <Input
                    name="shifMinimum"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={data.shifMinimum}
                  />
                </Field>
                <Field label="Housing levy % (employee)">
                  <Input
                    name="housingLevyEmployeePct"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={data.housingLevyEmployeePct}
                  />
                </Field>
                <Field label="Housing levy % (employer)">
                  <Input
                    name="housingLevyEmployerPct"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={data.housingLevyEmployerPct}
                  />
                </Field>
              </div>
            </>
          )}

          {save.isError && (
            <p className="text-sm text-danger-fg">
              {save.error instanceof ApiRequestError ? save.error.message : 'Failed to save'}
            </p>
          )}
          <Button type="submit" disabled={save.isPending}>
            Save payroll settings
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PipelineCard() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['settings', 'pipeline'],
    queryFn: () => api<PipelineConfig>('/settings/pipeline'),
  });
  const { data } = query;

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/settings/pipeline', { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('Quotation and contract defaults saved.');
      void qc.invalidateQueries({ queryKey: ['settings', 'pipeline'] });
      void qc.invalidateQueries({ queryKey: ['settings', 'quotationDefaults'] });
    },
    onError: (e) => toast.error(errText(e, 'The defaults were not saved.')),
  });

  if (!data) return <QueryState query={query} rows={2} noun="these settings" />;

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
          <dl className="grid gap-3 sm:grid-cols-3 rounded-lg border border-hairline bg-surface-muted/40 p-3 text-sm">
            {[
              ['Next quotation', data.nextQuotationNo],
              ['Next contract', data.nextContractNo],
              ['Next project code', data.nextProjectCode],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-fg-subtle">{label}</dt>
                <dd className="font-medium tabular-nums text-fg">{value}</dd>
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
            <Field label="Site prefix">
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

          {save.isError && <p className="text-sm text-danger-fg">Couldn&rsquo;t save those settings</p>}
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
  const query = useQuery({
    queryKey: ['settings', 'invoicing'],
    queryFn: () => api<InvoicingConfig>('/settings/invoicing'),
  });
  const { data } = query;

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/settings/invoicing', { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('Invoicing settings saved.');
      void qc.invalidateQueries({ queryKey: ['settings', 'invoicing'] });
    },
    onError: (e) => toast.error(errText(e, 'The settings were not saved.')),
  });

  if (!data) return <QueryState query={query} rows={2} noun="these settings" />;

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
              <dd className="font-medium tabular-nums text-fg">{data.nextInvoiceNo}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-subtle">Next receipt number</dt>
              <dd className="font-medium tabular-nums text-fg">{data.nextReceiptNo}</dd>
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

          {save.isError && (
            <p className="text-sm text-danger-fg">
              {save.error instanceof ApiRequestError ? save.error.message : 'Failed to save'}
            </p>
          )}
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
            placeholder="Link to fundi…"
            className="h-9 w-56 text-xs"
            aria-label="Link fingerprint to fundi"
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
