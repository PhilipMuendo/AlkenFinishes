import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2, Upload } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { ProjectDocument } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

const TYPES = ['CONTRACT', 'APPROVAL', 'CUSTOMER', 'RECEIPT', 'COMPLETION', 'PHOTO', 'OTHER'];

export function DocumentsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [deleting, setDeleting] = useState<ProjectDocument | null>(null);

  const { data: docs } = useQuery({
    queryKey: ['documents', projectId, filter],
    queryFn: () =>
      api<ProjectDocument[]>(
        `/projects/${projectId}/documents${filter ? `?type=${filter}` : ''}`,
      ),
  });

  const uploadDoc = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/documents`, { formData }),
    onSuccess: () => {
      toast.success('Document uploaded.');
      void qc.invalidateQueries({ queryKey: ['documents', projectId] });
      setOpen(false);
    },
    onError: (e) => toast.error(errText(e, 'The document was not uploaded.')),
  });

  const deleteDoc = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Document deleted.');
      void qc.invalidateQueries({ queryKey: ['documents', projectId] });
      setDeleting(null);
    },
    onError: (e) => toast.error(errText(e, 'The document was not deleted.')),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-auto"
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0) + t.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
        <Button onClick={() => setOpen(true)}>
          <Upload size={16} /> Upload document
        </Button>
      </div>

      {docs?.length === 0 ? (
        <Empty>No documents in this repository yet</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Uploaded by</Th>
              <Th>Date</Th>
              <Th>Size</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {docs?.map((d) => (
              <tr key={d.id}>
                <Td>
                  <a
                    href={d.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 font-medium text-brand-700 hover:underline"
                  >
                    <FileText size={15} /> {d.name}
                  </a>
                </Td>
                <Td>
                  <Badge>{d.type}</Badge>
                </Td>
                <Td>{d.uploadedBy.name}</Td>
                <Td className="whitespace-nowrap">{fmtDate(d.createdAt)}</Td>
                <Td className="tabular-nums">{(d.sizeBytes / 1024).toFixed(0)} KB</Td>
                <Td>
                  {!d.systemGenerated && (
                    <button
                      aria-label={`Delete ${d.name}`}
                      onClick={() => {
                        deleteDoc.reset();
                        setDeleting(d);
                      }}
                      className="rounded-lg p-1.5 text-fg-subtle transition-colors hover:bg-danger-surface hover:text-danger-fg"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete "${deleting.name}"?` : ''}
        description="This removes the file. It cannot be undone."
        pending={deleteDoc.isPending}
        error={
          deleteDoc.error instanceof ApiRequestError ? deleteDoc.error.message : null
        }
        onConfirm={() => deleteDoc.mutate(deleting!.id)}
      />

      <Dialog open={open} onClose={() => setOpen(false)} title="Upload document">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            uploadDoc.mutate(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <Field label="Document name">
            <Input name="name" required placeholder="Signed contract" />
          </Field>
          <Field label="Type">
            <Select name="type" required>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0) + t.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="File">
            <Input name="file" type="file" required accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" />
          </Field>
          {uploadDoc.isError && (
            <p className="text-sm text-danger-fg">
              {uploadDoc.error instanceof ApiRequestError ? uploadDoc.error.message : 'Upload failed'}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={uploadDoc.isPending}>
            Upload
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
