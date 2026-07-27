import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { CalendarRange, ClipboardList, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import type { Project, ReportFeedItem } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Select, Input } from '@/components/ui/input';
import { Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

type TypeFilter = '' | 'DAILY' | 'WEEKLY';

interface ReportFeed {
  items: ReportFeedItem[];
  nextCursor: string | null;
}

const DAILY_FIELDS: { key: keyof ReportFeedItem; label: string }[] = [
  { key: 'workCompleted', label: 'Work completed' },
  { key: 'materialsUsed', label: 'Materials used' },
  { key: 'challenges', label: 'Challenges' },
];

const WEEKLY_FIELDS: { key: keyof ReportFeedItem; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'issues', label: 'Issues & blockers' },
  { key: 'nextWeekPlan', label: 'Next week' },
];

function ReportRow({ r }: { r: ReportFeedItem }) {
  const isWeekly = r.type === 'WEEKLY';
  const fields = isWeekly ? WEEKLY_FIELDS : DAILY_FIELDS;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={isWeekly ? 'blue' : 'slate'}>
            {isWeekly ? <CalendarRange size={12} /> : <ClipboardList size={12} />}
            {isWeekly ? 'Weekly' : 'Daily'}
          </Badge>
          <span className="font-semibold text-fg">{r.project.name}</span>
        </div>
        <span className="text-xs text-fg-subtle">
          {isWeekly ? 'Week ending ' : ''}
          {fmtDate(r.date)} · {r.submittedBy.name}
          {r.type === 'DAILY' && r.workersPresent != null && ` · ${r.workersPresent} on site`}
        </span>
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        {fields.map(({ key, label }) =>
          r[key] ? (
            <div key={key}>
              <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</dt>
              <dd className="whitespace-pre-line text-fg">{r[key] as string}</dd>
            </div>
          ) : null,
        )}
      </dl>
      {r.photoUrls.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {r.photoUrls.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              <img
                src={url}
                alt="Site progress"
                loading="lazy"
                className="h-20 w-20 rounded-lg object-cover"
              />
            </a>
          ))}
        </div>
      )}
    </Card>
  );
}

export function ReportsPage() {
  const [projectId, setProjectId] = useState('');
  const [type, setType] = useState<TypeFilter>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
  });

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ['reports', { projectId, type, from, to }],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) => {
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', projectId);
      if (type) params.set('type', type);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (pageParam) params.set('cursor', pageParam);
      const qs = params.toString();
      return api<ReportFeed>(`/reports${qs ? `?${qs}` : ''}`);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const reports = data?.pages.flatMap((p) => p.items);

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Daily and weekly updates from every site" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Site">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All sites</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as TypeFilter)}>
            <option value="">All reports</option>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
          </Select>
        </Field>
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && reports?.length === 0 && (
        <Card>
          <CardContent>
            <Empty icon={FileText}>
              <p className="font-medium text-fg">No reports found</p>
              <p className="mt-1 max-w-xs text-fg-muted">
                {projectId || type || from || to
                  ? 'Try widening the filters above.'
                  : 'Reports submitted by supervisors will appear here.'}
              </p>
            </Empty>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {reports?.map((r) => (
          <ReportRow key={`${r.type}-${r.id}`} r={r} />
        ))}
      </div>

      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load older reports'}
          </Button>
        </div>
      )}
    </div>
  );
}
