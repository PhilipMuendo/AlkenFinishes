import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type {
  AnyCalendarEventType,
  CalendarEvent,
  CalendarEventType,
  Project,
} from '@/lib/types';
import { fmtDate, todayISO } from '@/lib/format';
import { calendarEventTone } from '@/lib/tone';
import { cn, focusRingOnMuted } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormError } from '@/components/ui/form-error';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';

/** Only these can be created — the rest are computed from other records. */
const BOOKABLE_TYPE_LABEL: Record<CalendarEventType, string> = {
  MILESTONE: 'Milestone',
  INSPECTION: 'Inspection',
  DELIVERY: 'Delivery',
  MEETING: 'Meeting',
  SITE_VISIT: 'Site visit',
  CLIENT_APPOINTMENT: 'Client appointment',
  OTHER: 'Other',
};

const TYPE_LABEL: Record<AnyCalendarEventType, string> = {
  ...BOOKABLE_TYPE_LABEL,
  PROJECT_DEADLINE: 'Deadline',
  PAYROLL: 'Payroll',
  EQUIPMENT_SERVICE: 'Service due',
  BIRTHDAY: 'Birthday',
  RETENTION_DUE: 'Retention due',
  WARRANTY_EXPIRY: 'Warranty ends',
};


function startOfToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CalendarPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [projectId, setProjectId] = useState('');
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<CalendarEvent | null>(null);

  const { data: events, isLoading } = useQuery({
    queryKey: queryKeys.calendar.byProject(projectId),
    queryFn: () =>
      api<CalendarEvent[]>(
        `/calendar?from=${startOfToday()}${projectId ? `&projectId=${projectId}` : ''}`,
      ),
  });
  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.all(),
    queryFn: () => api<Project[]>('/projects'),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: queryKeys.calendar.all() });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/calendar', { body }),
    onSuccess: () => {
      invalidate();
      setOpen(false);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/calendar/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      toast.success('Entry deleted');
      setDeleting(null);
    },
  });

  // Grouped by day so the list reads like a diary rather than a flat table.
  const groups = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) {
      const key = e.date.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return [...map.entries()];
  }, [events]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Milestones, inspections, deliveries and meetings across every site"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> New event
          </Button>
        }
      />

      <div className="max-w-[16rem]">
        <Field label="Site">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All sites (+ company-wide)</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {!isLoading && groups.length === 0 && (
        <Card>
          <CardContent>
            <Empty icon={CalendarDays}>
              <p className="font-medium text-fg">Nothing coming up</p>
              <p className="mt-1 max-w-xs text-fg-muted">
                Add a milestone, inspection or delivery date to keep it off the "did anyone tell
                me" list.
              </p>
            </Empty>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {groups.map(([date, dayEvents]) => (
          <div key={date}>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              {fmtDate(date)}
            </p>
            <div className="space-y-2">
              {dayEvents.map((e) => (
                <Card key={e.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={calendarEventTone[e.type]}>{TYPE_LABEL[e.type]}</Badge>
                      <p className="truncate font-medium text-fg">{e.title}</p>
                    </div>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {e.project ? e.project.name : 'Company-wide'}
                      {e.derived
                        ? ' · from the record itself'
                        : e.createdBy
                          ? ` · added by ${e.createdBy.name}`
                          : ''}
                    </p>
                    {e.notes && <p className="mt-1 text-sm text-fg-muted">{e.notes}</p>}
                  </div>
                  {/* A derived entry has no row to delete. The way to move a
                      deadline is to move the deadline. */}
                  {!e.derived && (
                    <button
                      onClick={() => setDeleting(e)}
                      aria-label={`Delete ${e.title}`}
                      className={cn(
                        'shrink-0 rounded-lg p-2 text-fg-subtle transition-colors hover:bg-red-50 hover:text-red-600',
                        focusRingOnMuted,
                      )}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="New calendar event">
        <form
          key={String(open)}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            create.mutate({
              title: fd.get('title'),
              type: fd.get('type'),
              date: fd.get('date'),
              projectId: fd.get('projectId') || null,
              notes: fd.get('notes') || undefined,
            });
          }}
          className="space-y-3"
        >
          <Field label="What's happening?">
            <Input name="title" required placeholder="Client inspection — first fix" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select name="type" defaultValue="OTHER">
                {(Object.keys(BOOKABLE_TYPE_LABEL) as CalendarEventType[]).map((t) => (
                  <option key={t} value={t}>
                    {BOOKABLE_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date">
              <Input name="date" type="date" defaultValue={todayISO()} required />
            </Field>
          </div>
          <Field label="Site (optional — leave blank for company-wide)">
            <Select name="projectId" defaultValue="">
              <option value="">Company-wide</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes (optional)">
            <Textarea name="notes" rows={2} />
          </Field>
          <FormError error={create.error} fallback="Failed to save" />
          <Button type="submit" className="w-full" disabled={create.isPending}>
            Add event
          </Button>
        </form>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        title="Delete this entry?"
        confirmLabel="Delete entry"
        pending={remove.isPending}
        error={remove.error}
        body={
          deleting && (
            <>
              <strong className="font-medium text-fg">{deleting.title}</strong> on{' '}
              {fmtDate(deleting.date)} will be removed from the calendar. This cannot be undone.
            </>
          )
        }
      />
    </div>
  );
}
