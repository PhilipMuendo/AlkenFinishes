import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, Plus, XCircle } from 'lucide-react';
import { api, errText } from '@/lib/api';
import type {
  QualityChecklistItem,
  QualityChecklistsResponse,
  QualityInspection,
  QualityItemStatus,
} from '@/lib/types';
import { fmtDate, thumbUrl } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { SkeletonList } from '@/components/ui/skeleton';
import { Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

const STATUS_TONE: Record<QualityItemStatus, 'green' | 'red' | 'slate'> = {
  PASS: 'green',
  FAIL: 'red',
  PENDING: 'slate',
};

const MAX_PHOTOS = 6;

/**
 * The standing quality checklist, run per area — "checked continuously, not
 * only at the end". A new inspection starts from the full checklist with
 * every point PENDING; editing it ticks points off individually as work
 * actually reaches each stage, rather than all at once at the finish.
 */
export function QualityInspectionPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<QualityInspection | null>(null);
  const [photoCount, setPhotoCount] = useState(0);

  const { data: checklists } = useQuery({
    queryKey: ['quality-inspections', 'checklists', projectId],
    queryFn: () => api<QualityChecklistsResponse>(`/projects/${projectId}/quality-inspections/checklists`),
  });

  const { data: inspections, isPending } = useQuery({
    queryKey: ['quality-inspections', projectId],
    queryFn: () => api<QualityInspection[]>(`/projects/${projectId}/quality-inspections`),
  });

  const create = useMutation({
    mutationFn: (formData: FormData) =>
      api<QualityInspection>(`/projects/${projectId}/quality-inspections`, { formData }),
    onSuccess: (inspection) => {
      toast.success('Inspection started.');
      void qc.invalidateQueries({ queryKey: ['quality-inspections', projectId] });
      setCreating(false);
      setPhotoCount(0);
      setViewing(inspection);
    },
    onError: (e) => toast.error(errText(e, 'The inspection could not be started.')),
  });

  const update = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) =>
      api<QualityInspection>(`/projects/${projectId}/quality-inspections/${id}`, {
        method: 'PATCH',
        formData,
      }),
    onSuccess: (inspection) => {
      toast.success('Inspection updated.');
      void qc.invalidateQueries({ queryKey: ['quality-inspections', projectId] });
      setViewing(inspection);
    },
    onError: (e) => toast.error(errText(e, 'The inspection could not be saved.')),
  });

  // Local, editable copy of the checklist for whichever inspection is open —
  // cleared/reset whenever a different one is opened via the dialog's key.
  const [items, setItems] = useState<QualityChecklistItem[]>([]);
  const openInspection = (i: QualityInspection) => {
    setItems(i.items);
    setViewing(i);
  };
  const setItemStatus = (index: number, status: QualityItemStatus) => {
    setItems((prev) => prev.map((it, idx) => (idx === index ? { ...it, status } : it)));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} /> New inspection
        </Button>
      </div>

      {isPending && <SkeletonList rows={2} />}

      {inspections?.length === 0 && (
        <Empty icon={ClipboardCheck}>
          <p className="font-medium text-fg">No inspections yet</p>
          <p className="mt-1 max-w-xs text-fg-muted">
            Run the checklist against an area as work reaches each stage — not just at the end.
          </p>
        </Empty>
      )}

      <div className="space-y-3">
        {inspections?.map((i) => {
          const passed = i.items.filter((it) => it.status === 'PASS').length;
          return (
            <Card key={i.id} className="cursor-pointer p-4" onClick={() => openInspection(i)}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-fg">{i.area}</p>
                    <Badge tone={STATUS_TONE[i.overallStatus]} className="capitalize">
                      {i.overallStatus.toLowerCase()}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    {i.checklistName} · {passed}/{i.items.length} passed · {i.inspectedBy.name} ·{' '}
                    {fmtDate(i.inspectedAt)}
                  </p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={creating} onClose={() => setCreating(false)} title="New quality inspection">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <Field label="Area">
            <Input name="area" required placeholder="Bedroom 1" />
          </Field>
          <Field label="Checklist">
            <Select name="checklistName" defaultValue={checklists?.default}>
              {(checklists?.names ?? []).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes (optional)">
            <Textarea name="notes" placeholder="General remarks about this area" />
          </Field>
          <Field
            label={`Photos (up to ${MAX_PHOTOS}, optional)`}
            hint={photoCount > 0 ? `${photoCount} selected` : undefined}
          >
            <Input
              name="photos"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setPhotoCount(e.target.files?.length ?? 0)}
            />
          </Field>
          {create.isError && <p className="text-sm text-danger-fg">{errText(create.error, 'Failed')}</p>}
          <Button type="submit" className="w-full" disabled={create.isPending}>
            Start inspection
          </Button>
        </form>
      </Dialog>

      <Dialog open={!!viewing} onClose={() => setViewing(null)} title={viewing?.area ?? ''}>
        {viewing && (
          <div className="space-y-4">
            <p className="text-xs text-fg-muted">
              {viewing.checklistName} · started by {viewing.inspectedBy.name} on{' '}
              {fmtDate(viewing.inspectedAt)}
            </p>

            <div className="space-y-1.5">
              {items.map((it, idx) => (
                <div
                  key={it.label}
                  className="flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2"
                >
                  <span className="text-sm text-fg">{it.label}</span>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => setItemStatus(idx, 'PASS')}
                      aria-label={`Mark ${it.label} as pass`}
                      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                        it.status === 'PASS' ? 'bg-good-surface text-good-fg' : 'text-fg-subtle hover:bg-surface-sunken'
                      }`}
                    >
                      <CheckCircle2 size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setItemStatus(idx, 'FAIL')}
                      aria-label={`Mark ${it.label} as fail`}
                      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                        it.status === 'FAIL' ? 'bg-danger-surface text-danger-fg' : 'text-fg-subtle hover:bg-surface-sunken'
                      }`}
                    >
                      <XCircle size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {viewing.photoUrls.length > 0 && (
              <div className="flex gap-2 overflow-x-auto">
                {viewing.photoUrls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    <img
                      src={thumbUrl(url, 160)}
                      alt="Inspection evidence"
                      loading="lazy"
                      className="h-16 w-16 rounded-lg object-cover"
                    />
                  </a>
                ))}
              </div>
            )}

            {update.isError && <p className="text-sm text-danger-fg">{errText(update.error, 'Failed')}</p>}
            <Button
              className="w-full"
              disabled={update.isPending}
              onClick={() => {
                const fd = new FormData();
                fd.set('items', JSON.stringify(items));
                update.mutate({ id: viewing.id, formData: fd });
              }}
            >
              Save checklist
            </Button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
