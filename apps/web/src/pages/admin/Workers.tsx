import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Upload } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import type { Project, Worker } from '@/lib/types';
import { fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { HardHat } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const IMPORT_TEMPLATE_CSV =
  'Name,Phone,Trade,Hourly Rate,Biometric ID\nJohn Mwangi,0712345678,Painter,300,\nPeter Otieno,0723456789,Tiler,350,\n';

function downloadImportTemplate() {
  const blob = new Blob([IMPORT_TEMPLATE_CSV], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fundi-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

interface ImportRowResult {
  row: number;
  name?: string;
  status: 'created' | 'error';
  warning?: string;
  error?: string;
}
interface ImportResponse {
  totalRows: number;
  created: number;
  results: ImportRowResult[];
}

export function WorkersPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [assigning, setAssigning] = useState<Worker | null>(null);
  const [deleting, setDeleting] = useState<Worker | null>(null);

  const { data: workers } = useQuery({
    queryKey: ['workers'],
    queryFn: () => api<Worker[]>('/workers'),
  });
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['workers'] });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/workers', { body }),
    onSuccess: () => {
      invalidate();
      setOpen(false);
    },
  });

  const assign = useMutation({
    mutationFn: ({ workerId, projectId }: { workerId: string; projectId: string }) =>
      api(`/workers/${workerId}/assign`, { body: { projectId } }),
    onSuccess: () => {
      invalidate();
      setAssigning(null);
    },
  });

  const unassign = useMutation({
    mutationFn: (workerId: string) => api(`/workers/${workerId}/unassign`, { body: {} }),
    onSuccess: invalidate,
  });

  const importWorkers = useMutation({
    mutationFn: (formData: FormData) => api<ImportResponse>('/workers/import', { formData }),
    onSuccess: (data) => {
      invalidate();
      setImportResult(data);
    },
  });

  const deleteWorker = useMutation({
    mutationFn: (id: string) => api(`/workers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      setDeleting(null);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workers"
        description="Fundis and site workers across all projects"
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload size={16} /> Import
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} /> Add worker
            </Button>
          </>
        }
      />

      {workers?.length === 0 ? (
        <Card>
          <CardContent>
            <Empty icon={HardHat}>
              <p className="font-medium text-fg">No workers yet</p>
              <p className="mt-1 max-w-xs text-fg-muted">
                Add fundis one at a time, or import a whole crew from a spreadsheet.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <Upload size={16} /> Import
                </Button>
                <Button onClick={() => setOpen(true)}>
                  <Plus size={16} /> Add worker
                </Button>
              </div>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Trade</Th>
              <Th className="text-right">Hourly rate</Th>
              <Th>Biometric ID</Th>
              <Th>Current site</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {workers?.map((w) => (
              <tr key={w.id}>
                <Td>
                  <span className="font-medium text-fg">{w.name}</span>
                  <p className="text-xs text-fg-subtle">{w.phone ?? '—'}</p>
                </Td>
                <Td>{w.trade}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(Number(w.hourlyRate))}/hr</Td>
                <Td>
                  {w.biometricId ? (
                    <Badge tone="green">Enrolled</Badge>
                  ) : (
                    <Badge tone="yellow">Not enrolled</Badge>
                  )}
                </Td>
                <Td>
                  {w.assignments[0]?.project.name ?? (
                    <span className="text-fg-subtle">Unassigned</span>
                  )}
                </Td>
                <Td>
                  <Badge tone={w.status === 'ACTIVE' ? 'green' : 'slate'}>{w.status}</Badge>
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1.5">
                    {w.assignments[0] ? (
                      <Button size="sm" variant="outline" onClick={() => unassign.mutate(w.id)}>
                        Unassign
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setAssigning(w)}>
                        Assign to site
                      </Button>
                    )}
                    <button
                      className="rounded-lg p-2 text-fg-subtle transition-colors hover:bg-red-50 hover:text-red-600"
                      aria-label={`Delete ${w.name}`}
                      onClick={() => setDeleting(w)}
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
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="Add worker">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            create.mutate({
              name: fd.get('name'),
              phone: fd.get('phone') || null,
              trade: fd.get('trade'),
              hourlyRate: Number(fd.get('hourlyRate')),
              biometricId: fd.get('biometricId') || null,
            });
          }}
          className="space-y-3"
        >
          <Field label="Full name">
            <Input name="name" required />
          </Field>
          <Field label="Phone">
            <Input name="phone" type="tel" />
          </Field>
          <Field label="Trade">
            <Input name="trade" required placeholder="Painter, Tiler, Mason…" />
          </Field>
          <Field label="Hourly rate (KES)">
            <Input name="hourlyRate" type="number" min="0" max="5000" step="0.01" required />
          </Field>
          <Field label="Biometric ID (from fingerprint device)">
            <Input name="biometricId" placeholder="Device enrolment ID" />
          </Field>
          {create.isError && (
            <p className="text-sm text-red-600">
              {create.error instanceof ApiRequestError ? create.error.message : 'Failed to add worker'}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={create.isPending}>
            Add worker
          </Button>
        </form>
      </Dialog>

      <Dialog
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setImportResult(null);
        }}
        title="Import fundis"
      >
        {importResult ? (
          <div className="space-y-3">
            <p className="text-sm text-fg">
              Imported <span className="font-medium">{importResult.created}</span> of{' '}
              {importResult.totalRows} rows.
            </p>
            {importResult.results.some((r) => r.status === 'error' || r.warning) && (
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-hairline p-2 text-xs">
                {importResult.results
                  .filter((r) => r.status === 'error' || r.warning)
                  .map((r) => (
                    <p key={r.row} className={r.status === 'error' ? 'text-red-600' : 'text-amber-700'}>
                      Row {r.row}
                      {r.name ? ` (${r.name})` : ''}: {r.error ?? r.warning}
                    </p>
                  ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setImportResult(null)} className="flex-1">
                Import another file
              </Button>
              <Button
                onClick={() => {
                  setImportOpen(false);
                  setImportResult(null);
                }}
                className="flex-1"
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            key={String(importOpen)}
            onSubmit={(e) => {
              e.preventDefault();
              importWorkers.mutate(new FormData(e.currentTarget));
            }}
            className="space-y-3"
          >
            <p className="text-sm text-fg-muted">
              Upload a CSV or Excel file with your fundi list — columns: Name, Phone, Trade,
              Hourly Rate, and optionally Biometric ID.{' '}
              <button
                type="button"
                onClick={downloadImportTemplate}
                className="text-brand-700 underline"
              >
                Download a template
              </button>
              .
            </p>
            <Field label="File">
              <Input name="file" type="file" accept=".csv,.xlsx,.xls" required />
            </Field>
            {importWorkers.isError && (
              <p className="text-sm text-red-600">
                Import failed — check the file is a valid spreadsheet under 500 rows.
              </p>
            )}
            <Button type="submit" className="w-full" disabled={importWorkers.isPending}>
              {importWorkers.isPending ? 'Importing…' : 'Import'}
            </Button>
          </form>
        )}
      </Dialog>

      <Dialog
        open={!!assigning}
        onClose={() => setAssigning(null)}
        title={assigning ? `Assign ${assigning.name}` : ''}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            assign.mutate({ workerId: assigning!.id, projectId: fd.get('projectId') as string });
          }}
          className="space-y-3"
        >
          <Field label="Site / project">
            <Combobox
              name="projectId"
              placeholder="Search site…"
              aria-label="Site / project"
              options={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={assign.isPending}>
            Assign
          </Button>
        </form>
      </Dialog>

      <Dialog
        open={!!deleting}
        onClose={() => {
          setDeleting(null);
          deleteWorker.reset();
        }}
        title={deleting ? `Delete ${deleting.name}?` : ''}
      >
        {deleting && (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              This permanently removes <span className="font-medium text-fg">{deleting.name}</span>{' '}
              and can&rsquo;t be undone. Workers with attendance history can&rsquo;t be deleted —
              unassign them from their site instead to preserve those records.
            </p>
            {deleteWorker.isError && (
              <p className="text-sm text-red-600">
                {deleteWorker.error instanceof ApiRequestError
                  ? deleteWorker.error.message
                  : 'Failed to delete this worker'}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setDeleting(null);
                  deleteWorker.reset();
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={deleteWorker.isPending}
                onClick={() => deleteWorker.mutate(deleting.id)}
              >
                Delete permanently
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
