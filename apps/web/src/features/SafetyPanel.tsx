import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HardHat, Plus, Trash2 } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { SafetyIncident, SafetyIncidentSeverity } from '@/lib/types';
import { fmtDate, nowLocalDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

const SEVERITY_LABEL: Record<SafetyIncidentSeverity, string> = {
  NEAR_MISS: 'Near miss',
  MINOR: 'Minor',
  SERIOUS: 'Serious',
};
const SEVERITY_TONE: Record<SafetyIncidentSeverity, 'slate' | 'yellow' | 'red'> = {
  NEAR_MISS: 'slate',
  MINOR: 'yellow',
  SERIOUS: 'red',
};

export function SafetyPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPERADMIN';
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<SafetyIncident | null>(null);

  const { data: incidents } = useQuery({
    queryKey: ['safety-incidents', projectId],
    queryFn: () => api<SafetyIncident[]>(`/projects/${projectId}/safety-incidents`),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['safety-incidents', projectId] });

  const create = useMutation({
    mutationFn: (formData: FormData) => api(`/projects/${projectId}/safety-incidents`, { formData }),
    onSuccess: () => {
      toast.success('Incident recorded.');
      invalidate();
      setOpen(false);
    },
    onError: (e) => toast.error(errText(e, 'The incident was not recorded.')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/projects/${projectId}/safety-incidents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Incident deleted.');
      invalidate();
      setDeleting(null);
    },
    onError: (e) => toast.error(errText(e, 'The incident was not deleted.')),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> Log incident
        </Button>
      </div>

      {incidents?.length === 0 && (
        <Card className="p-8">
          <Empty icon={HardHat}>
            <p className="font-medium text-fg">Nothing logged</p>
            <p className="mt-1 max-w-xs text-fg-muted">
              Near misses are worth recording too — the pattern in these is what prevents the
              serious one.
            </p>
          </Empty>
        </Card>
      )}

      <div className="space-y-2">
        {incidents?.map((i) => (
          <Card key={i.id} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-fg">{i.description}</p>
                <p className="mt-1 text-xs text-fg-subtle">
                  {fmtDate(i.occurredAt)} · reported by {i.reportedBy.name}
                </p>
                {i.actionTaken && (
                  <p className="mt-1 text-xs text-fg-muted">Action taken: {i.actionTaken}</p>
                )}
              </div>
              <div className="flex shrink-0 items-start gap-1.5">
                <Badge tone={SEVERITY_TONE[i.severity]}>{SEVERITY_LABEL[i.severity]}</Badge>
                {(isAdmin || i.reportedBy.id === user?.id) && (
                  <button
                    aria-label="Delete incident"
                    onClick={() => {
                      remove.reset();
                      setDeleting(i);
                    }}
                    className="rounded-lg p-1 text-fg-subtle transition-colors hover:bg-danger-surface hover:text-danger-fg"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
            {i.photoUrl && (
              <a href={i.photoUrl} target="_blank" rel="noreferrer" className="mt-2 block">
                <img src={i.photoUrl} alt="" className="h-24 w-24 rounded-lg object-cover" />
              </a>
            )}
          </Card>
        ))}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Log a safety incident">
        <form
          key={String(open)}
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <Field label="When">
            <Input name="occurredAt" type="datetime-local" defaultValue={nowLocalDateTime()} required />
          </Field>
          <Field label="Severity">
            <Select name="severity" defaultValue="NEAR_MISS">
              <option value="NEAR_MISS">Near miss — nobody hurt</option>
              <option value="MINOR">Minor — first aid only</option>
              <option value="SERIOUS">Serious — medical attention needed</option>
            </Select>
          </Field>
          <Field label="What happened">
            <Textarea name="description" required rows={3} autoFocus />
          </Field>
          <Field label="Action taken (optional)">
            <Textarea name="actionTaken" rows={2} />
          </Field>
          <Field label="Photo (optional)">
            <Input name="photo" type="file" accept="image/*" capture="environment" />
          </Field>
          {create.isError && (
            <p className="text-sm text-danger-fg">
              {create.error instanceof ApiRequestError ? create.error.message : 'Failed to save'}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={create.isPending}>
            Save
          </Button>
        </form>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this incident?"
        description="This removes the record entirely. It cannot be undone."
        pending={remove.isPending}
        error={remove.error instanceof ApiRequestError ? remove.error.message : null}
        onConfirm={() => remove.mutate(deleting!.id)}
      />
    </div>
  );
}
