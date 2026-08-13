import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Trash2, Upload } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { ProjectDocument } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input } from '@/components/ui/input';
import { Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

/**
 * Site photos, kept separate from the daily-report photo field: a photo
 * belongs to the site, not to whichever day someone happened to submit a
 * report — and unlike a report, a photo here can be replaced or taken down
 * without editing history nobody meant to touch.
 *
 * Backed by the document repository filtered to PHOTO — the same store the
 * office's Documents tab reads, so a photo added here shows up there too.
 * The API lets anyone with site access delete a PHOTO-type document (and
 * only that type); everything else in the repository stays office-only.
 */
export function PhotosPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<ProjectDocument | null>(null);

  const { data: photos } = useQuery({
    queryKey: ['documents', projectId, 'PHOTO'],
    queryFn: () => api<ProjectDocument[]>(`/projects/${projectId}/documents?type=PHOTO`),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['documents', projectId, 'PHOTO'] });

  const upload = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/documents`, { formData }),
    onSuccess: () => {
      toast.success('Photo added.');
      invalidate();
      setOpen(false);
    },
    onError: (e) => toast.error(errText(e, 'The photo was not uploaded.')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Photo removed.');
      invalidate();
      setDeleting(null);
    },
    onError: (e) => toast.error(errText(e, 'The photo was not removed.')),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Upload size={16} /> Add photo
        </Button>
      </div>

      {photos?.length === 0 && (
        <Card className="p-8">
          <Empty icon={Camera}>
            <p className="font-medium text-fg">No photos yet</p>
            <p className="mt-1 max-w-xs text-fg-muted">
              Add photos of the site here — progress shots, deliveries, anything worth keeping on
              record outside a daily report.
            </p>
          </Empty>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos?.map((p) => (
          <div key={p.id} className="group relative overflow-hidden rounded-xl border border-hairline">
            <a href={p.fileUrl} target="_blank" rel="noreferrer">
              <img src={p.fileUrl} alt={p.name} className="aspect-square w-full object-cover" />
            </a>
            <button
              aria-label={`Delete ${p.name}`}
              onClick={() => {
                remove.reset();
                setDeleting(p);
              }}
              className="absolute right-1.5 top-1.5 rounded-lg bg-slate-950/60 p-1.5 text-white opacity-0 transition-opacity hover:bg-danger-surface hover:text-danger-fg group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Trash2 size={14} />
            </button>
            <div className="p-2">
              <p className="truncate text-xs font-medium text-fg">{p.name}</p>
              <p className="text-[11px] text-fg-subtle">
                {fmtDate(p.createdAt)} · {p.uploadedBy.name}
              </p>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add a photo">
        <form
          key={String(open)}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set('type', 'PHOTO');
            upload.mutate(fd);
          }}
          className="space-y-3"
        >
          <Field label="What is it?">
            <Input name="name" required placeholder="Front elevation, block A" />
          </Field>
          <Field label="Photo">
            <Input name="file" type="file" required accept="image/*" capture="environment" />
          </Field>
          {upload.isError && (
            <p className="text-sm text-danger-fg">
              {upload.error instanceof ApiRequestError ? upload.error.message : 'Upload failed'}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={upload.isPending}>
            Add photo
          </Button>
        </form>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete "${deleting.name}"?` : ''}
        description="This removes the photo. It cannot be undone."
        pending={remove.isPending}
        error={remove.error instanceof ApiRequestError ? remove.error.message : null}
        onConfirm={() => remove.mutate(deleting!.id)}
      />
    </div>
  );
}
