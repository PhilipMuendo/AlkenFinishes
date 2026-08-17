import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, Camera, CheckCircle2, Plus, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { cn, focusRing, focusRingOnMuted } from '@/lib/utils';
import type { SnagItem, SnagStatus } from '@/lib/types';
import { fmtDate, todayISO } from '@/lib/format';
import { snagSeverityTone, snagStatusTone } from '@/lib/tone';
import { Badge } from '@/components/ui/badge';
import { FormError } from '@/components/ui/form-error';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Empty } from '@/components/ui/table';


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
  // One blob URL per file, revoked on unmount. Creating it inline in the render
  // body minted a fresh URL on every keystroke elsewhere in the form and never
  // released any of them — on a phone, with full-size photos, that adds up.
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const pinAt = (rect: DOMRect, clientX: number, clientY: number) =>
    onPin({ x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height });

  return (
    <div className="space-y-1">
      {/* A button, not a div: pinning is the whole point of this control, and
          it has to be reachable without a touchscreen. Enter/Space drop the pin
          in the middle, which the arrow keys then adjust. */}
      <button
        type="button"
        aria-label="Pin the defect location on the photo"
        className={cn(
          'relative block w-full cursor-crosshair overflow-hidden rounded-lg',
          focusRing,
        )}
        onClick={(e) => pinAt(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPin(pin ?? { x: 0.5, y: 0.5 });
            return;
          }
          const step = 0.02;
          const nudge: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          };
          const delta = nudge[e.key];
          if (!delta) return;
          e.preventDefault();
          const from = pin ?? { x: 0.5, y: 0.5 };
          onPin({
            x: Math.min(1, Math.max(0, from.x + delta[0])),
            y: Math.min(1, Math.max(0, from.y + delta[1])),
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
      </button>
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
    queryKey: queryKeys.snags.filtered(projectId, statusFilter),
    queryFn: () => api<SnagItem[]>(`/projects/${projectId}/snags${statusFilter ? `?status=${statusFilter}` : ''}`),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: queryKeys.snags.byProject(projectId) });

  const create = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/snags`, { formData }),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setPickedFile(null);
      setPin(null);
    },
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) =>
      api(`/projects/${projectId}/snags/${id}/status`, { formData }),
    onSuccess: () => {
      invalidate();
      setViewing(null);
      setResolving(null);
    },
  });

  const verify = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/snags/${id}/verify`, { body: {} }),
    onSuccess: () => {
      invalidate();
      setViewing(null);
    },
  });

  const reopen = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/snags/${id}/reopen`, { body: {} }),
    onSuccess: () => {
      invalidate();
      setViewing(null);
    },
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

      {/* Each card opens the defect, so each card is a button — a div with an
          onClick was unreachable by keyboard and invisible to a screen reader. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {snags?.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setViewing(s)}
            className={cn(
              'block w-full overflow-hidden rounded-xl border border-hairline bg-surface text-left shadow-sm transition-shadow hover:shadow-md',
              focusRingOnMuted,
            )}
          >
            {s.photoUrl && <PhotoWithPin src={s.photoUrl} pin={s.annotation} />}
            <div className="p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-fg">{s.title}</p>
                <Badge tone={snagSeverityTone[s.severity]}>{s.severity}</Badge>
              </div>
              {s.location && <p className="mt-0.5 text-xs text-fg-subtle">{s.location}</p>}
              <div className="mt-2 flex items-center justify-between">
                <Badge tone={snagStatusTone[s.status]} className="capitalize">
                  {s.status.replace('_', ' ').toLowerCase()}
                </Badge>
                <span className="text-xs text-fg-subtle">{fmtDate(s.createdAt)}</span>
              </div>
            </div>
          </button>
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

          <FormError error={create.error} fallback="Failed to save" />
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
              <Badge tone={snagSeverityTone[viewing.severity]}>{viewing.severity}</Badge>
              <Badge tone={snagStatusTone[viewing.status]} className="capitalize">
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
          <FormError error={changeStatus.error} fallback="Failed to save" />
          <Button type="submit" className="w-full" disabled={changeStatus.isPending}>
            Mark resolved
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
