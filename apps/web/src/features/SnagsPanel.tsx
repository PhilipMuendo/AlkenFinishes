import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, Camera, CheckCircle2, Plus, RotateCcw } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { SnagItem, SnagSeverity, SnagStatus } from '@/lib/types';
import { fmtDate, todayISO } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

const SEVERITY_TONE: Record<SnagSeverity, 'slate' | 'yellow' | 'red'> = {
  LOW: 'slate',
  MEDIUM: 'yellow',
  HIGH: 'red',
};
const STATUS_TONE: Record<SnagStatus, 'red' | 'yellow' | 'blue' | 'green'> = {
  OPEN: 'red',
  IN_PROGRESS: 'yellow',
  RESOLVED: 'blue',
  VERIFIED: 'green',
};

/** A pin overlaid on a photo at a {x,y} fraction — the point of the annotation. */
function PhotoWithPin({ src, pin }: { src: string; pin: { x: number; y: number } | null }) {
  return (
    <div className="relative overflow-hidden rounded-lg">
      <img src={src} alt="" className="w-full object-cover" />
      {pin && (
        <div
          className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-red-600 shadow"
          style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
        />
      )}
    </div>
  );
}

/** Click-anywhere-on-the-image picker used while creating a new snag. */
function PhotoPinPicker({
  file,
  pin,
  onPin,
}: {
  file: File;
  pin: { x: number; y: number } | null;
  onPin: (p: { x: number; y: number }) => void;
}) {
  const url = URL.createObjectURL(file);
  return (
    <div className="space-y-1">
      <div
        className="relative cursor-crosshair overflow-hidden rounded-lg"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onPin({
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height,
          });
        }}
      >
        <img src={url} alt="" className="w-full object-cover" />
        {pin && (
          <div
            className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-red-600 shadow"
            style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
          />
        )}
      </div>
      <p className="text-xs text-fg-subtle">Tap the photo to pin exactly where the defect is.</p>
    </div>
  );
}

export function SnagsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<SnagStatus | ''>('');
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<SnagItem | null>(null);
  const [resolving, setResolving] = useState<SnagItem | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: snags } = useQuery({
    queryKey: ['snags', projectId, statusFilter],
    queryFn: () => api<SnagItem[]>(`/projects/${projectId}/snags${statusFilter ? `?status=${statusFilter}` : ''}`),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['snags', projectId] });

  const create = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/snags`, { formData }),
    onSuccess: () => {
      toast.success('Defect raised. It stays open until it is fixed and signed off.');
      invalidate();
      setOpen(false);
      setPickedFile(null);
      setPin(null);
    },
    onError: (e) => toast.error(errText(e, 'The defect was not raised.')),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) =>
      api(`/projects/${projectId}/snags/${id}/status`, { formData }),
    onSuccess: () => {
      toast.success('Defect updated.');
      invalidate();
      setViewing(null);
      setResolving(null);
    },
    onError: (e) => toast.error(errText(e, 'The defect was not updated.')),
  });

  const verify = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/snags/${id}/verify`, { body: {} }),
    onSuccess: () => {
      toast.success('Defect signed off.');
      invalidate();
      setViewing(null);
    },
    onError: (e) => toast.error(errText(e, 'The defect was not signed off.')),
  });

  const reopen = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/snags/${id}/reopen`, { body: {} }),
    onSuccess: () => {
      toast.success('Defect reopened.');
      invalidate();
      setViewing(null);
    },
    onError: (e) => toast.error(errText(e, 'The defect was not reopened.')),
  });

  const startInProgress = (id: string) => {
    const fd = new FormData();
    fd.set('status', 'IN_PROGRESS');
    changeStatus.mutate({ id, formData: fd });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="max-w-[10rem]">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as SnagStatus | '')}>
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="RESOLVED">Resolved</option>
            <option value="VERIFIED">Verified</option>
          </Select>
        </div>
        <Button
          onClick={() => {
            create.reset();
            setOpen(true);
          }}
        >
          <Plus size={16} /> Report defect
        </Button>
      </div>

      {snags?.length === 0 && (
        <Card className="p-8">
          <Empty icon={AlertOctagon}>
            <p className="font-medium text-fg">No defects logged</p>
            <p className="mt-1 max-w-xs text-fg-muted">
              Photograph a defect and pin exactly where it is — the office can verify the fix
              without a return visit.
            </p>
          </Empty>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {snags?.map((s) => (
          <Card key={s.id} className="cursor-pointer overflow-hidden p-0" onClick={() => setViewing(s)}>
            {s.photoUrl && <PhotoWithPin src={s.photoUrl} pin={s.annotation} />}
            <div className="p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-fg">{s.title}</p>
                <Badge tone={SEVERITY_TONE[s.severity]}>{s.severity}</Badge>
              </div>
              {s.location && <p className="mt-0.5 text-xs text-fg-subtle">{s.location}</p>}
              <div className="mt-2 flex items-center justify-between">
                <Badge tone={STATUS_TONE[s.status]} className="capitalize">
                  {s.status.replace('_', ' ').toLowerCase()}
                </Badge>
                <span className="text-xs text-fg-subtle">{fmtDate(s.createdAt)}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* ---- Report ---- */}
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setPickedFile(null);
          setPin(null);
        }}
        title="Report a defect"
      >
        <form
          key={String(open)}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            if (pickedFile) fd.set('photo', pickedFile);
            if (pin) fd.set('annotation', JSON.stringify(pin));
            create.mutate(fd);
          }}
          className="space-y-3"
        >
          <Field label="What's wrong?">
            <Input name="title" required placeholder="Crack in wall" autoFocus />
          </Field>
          <Field label="Location">
            <Input name="location" placeholder="3rd floor, unit 3B, bathroom" />
          </Field>
          <Field label="Description (optional)">
            <Textarea name="description" rows={2} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Severity">
              <Select name="severity" defaultValue="MEDIUM">
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </Select>
            </Field>
            <Field label="Due date (optional)">
              <Input name="dueDate" type="date" min={todayISO()} />
            </Field>
          </div>

          <Field label="Photo">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setPickedFile(f);
                setPin(null);
              }}
            />
            {!pickedFile ? (
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Camera size={16} /> Add photo
              </Button>
            ) : (
              <PhotoPinPicker file={pickedFile} pin={pin} onPin={setPin} />
            )}
          </Field>

          {create.isError && (
            <p className="text-sm text-danger-fg">
              {create.error instanceof ApiRequestError ? create.error.message : 'Failed to save'}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={create.isPending}>
            Report defect
          </Button>
        </form>
      </Dialog>

      {/* ---- Detail ---- */}
      <Dialog open={!!viewing} onClose={() => setViewing(null)} title={viewing?.title ?? ''}>
        {viewing && (
          <div className="space-y-3">
            {viewing.photoUrl && <PhotoWithPin src={viewing.photoUrl} pin={viewing.annotation} />}
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={SEVERITY_TONE[viewing.severity]}>{viewing.severity}</Badge>
              <Badge tone={STATUS_TONE[viewing.status]} className="capitalize">
                {viewing.status.replace('_', ' ').toLowerCase()}
              </Badge>
            </div>
            {viewing.location && <p className="text-sm text-fg-muted">{viewing.location}</p>}
            {viewing.description && <p className="text-sm text-fg">{viewing.description}</p>}
            <p className="text-xs text-fg-subtle">
              Reported by {viewing.reportedBy.name} on {fmtDate(viewing.createdAt)}
              {viewing.dueDate && ` · due ${fmtDate(viewing.dueDate)}`}
            </p>

            {viewing.resolvedPhotoUrl && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase text-fg-subtle">Fix photo</p>
                <img src={viewing.resolvedPhotoUrl} alt="" className="w-full rounded-lg object-cover" />
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-hairline pt-3">
              {viewing.status === 'OPEN' && (
                <Button onClick={() => startInProgress(viewing.id)} disabled={changeStatus.isPending}>
                  Start work
                </Button>
              )}
              {(viewing.status === 'OPEN' || viewing.status === 'IN_PROGRESS') && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    changeStatus.reset();
                    setResolving(viewing);
                  }}
                >
                  <CheckCircle2 size={16} /> Mark resolved
                </Button>
              )}
              {viewing.status === 'RESOLVED' && (
                <>
                  <Button disabled={verify.isPending} onClick={() => verify.mutate(viewing.id)}>
                    Confirm fix
                  </Button>
                  <Button variant="outline" disabled={reopen.isPending} onClick={() => reopen.mutate(viewing.id)}>
                    <RotateCcw size={16} /> Not fixed — reopen
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Dialog>

      {/* ---- Resolve (photo required) ---- */}
      <Dialog open={!!resolving} onClose={() => setResolving(null)} title="Mark resolved">
        <form
          key={resolving?.id ?? 'none'}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set('status', 'RESOLVED');
            changeStatus.mutate({ id: resolving!.id, formData: fd });
          }}
          className="space-y-3"
        >
          <Field label="Photo of the fix">
            <Input name="resolvedPhoto" type="file" accept="image/*" capture="environment" required />
          </Field>
          <p className="text-xs text-fg-subtle">
            A photo is required — it's what lets the office verify the fix without visiting.
          </p>
          {changeStatus.isError && (
            <p className="text-sm text-danger-fg">
              {changeStatus.error instanceof ApiRequestError ? changeStatus.error.message : 'Failed to save'}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={changeStatus.isPending}>
            Mark resolved
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
