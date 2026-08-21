import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type {
  AnyCalendarEventType,
  CalendarEvent,
  CalendarEventType,
  Project,
} from '@/lib/types';
import { fmtDate, todayISO } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { QueryState } from '@/components/ui/query-state';
import { Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { toast } from '@/components/ui/toast';

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

type Tone = 'blue' | 'yellow' | 'green' | 'slate' | 'red';
const TYPE_TONE: Record<AnyCalendarEventType, Tone> = {
  MILESTONE: 'blue',
  INSPECTION: 'yellow',
  DELIVERY: 'green',
  MEETING: 'slate',
  SITE_VISIT: 'blue',
  CLIENT_APPOINTMENT: 'blue',
  OTHER: 'slate',
  // Dates with money or a deadline behind them read louder than a meeting.
  PROJECT_DEADLINE: 'red',
  RETENTION_DUE: 'green',
  WARRANTY_EXPIRY: 'yellow',
  EQUIPMENT_SERVICE: 'yellow',
  PAYROLL: 'green',
  BIRTHDAY: 'slate',
};

function startOfToday(): string {
  return todayISO();
}

export function CalendarPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState('');
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<CalendarEvent | null>(null);

  const eventsQuery = useQuery({
    queryKey: ['calendar', projectId],
    queryFn: () =>
      api<CalendarEvent[]>(
        `/calendar?from=${startOfToday()}${projectId ? `&projectId=${projectId}` : ''}`,
      ),
  });
  const { data: events, isLoading } = eventsQuery;
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['calendar'] });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/calendar', { body }),
    onSuccess: () => {
      toast.success('Event added to the calendar.');
      invalidate();
      setOpen(false);
    },
    onError: (e) => toast.error(errText(e, 'The event was not added.')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/calendar/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Event removed.');
      invalidate();
    },
    onError: (e) => toast.error(errText(e, 'The event was not removed.')),
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

      <QueryState query={eventsQuery} rows={3} noun="the calendar" />

      {!isLoading && groups.length === 0 && (
        <Empty icon={CalendarDays}>
          <p className="font-medium text-fg">Nothing coming up</p>
          <p className="mt-1 max-w-xs text-fg-muted">
            Add a milestone, inspection or delivery date to keep it off the "did anyone tell
            me" list.
          </p>
        </Empty>
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
                      <Badge tone={TYPE_TONE[e.type]}>{TYPE_LABEL[e.type]}</Badge>
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
                      className="shrink-0 rounded-lg p-2 text-fg-subtle transition-colors hover:bg-danger-surface hover:text-danger-fg"
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
          {create.isError && (
            <p className="text-sm text-danger-fg">
              {create.error instanceof ApiRequestError ? create.error.message : 'Failed to save'}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={create.isPending}>
            Add event
          </Button>
        </form>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => {
          setDeleting(null);
          remove.reset();
        }}
        title="Remove this event?"
        description={
          deleting
            ? `"${deleting.title}" on ${fmtDate(deleting.date)}${
                deleting.project ? ` for ${deleting.project.name}` : ''
              } will be taken off the calendar. Nobody is notified.`
            : undefined
        }
        confirmLabel="Remove event"
        pending={remove.isPending}
        error={remove.isError ? errText(remove.error, 'The event was not removed.') : null}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
