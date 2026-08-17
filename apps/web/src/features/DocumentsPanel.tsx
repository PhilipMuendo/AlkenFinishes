import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { ProjectDocument } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th, Empty } from '@/components/ui/table';

const TYPES = ['CONTRACT', 'APPROVAL', 'CUSTOMER', 'RECEIPT', 'COMPLETION', 'PHOTO', 'OTHER'];

export function DocumentsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const { data: docs } = useQuery({
    queryKey: queryKeys.documents.filtered(projectId, filter),
    queryFn: () =>
      api<ProjectDocument[]>(
        `/projects/${projectId}/documents${filter ? `?type=${filter}` : ''}`,
      ),
  });

  const uploadDoc = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/documents`, { formData }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.documents.byProject(projectId) });
      setOpen(false);
    },
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
                <Td className="nums">{(d.sizeBytes / 1024).toFixed(0)} KB</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

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
          <FormError error={uploadDoc.error} fallback="Upload failed" />
          <Button type="submit" className="w-full" disabled={uploadDoc.isPending}>
            Upload
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
