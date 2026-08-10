import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertOctagon,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Fingerprint,
  MapPin,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import type { DailyReport, Project } from '@/lib/types';
import { todayISO } from '@/lib/format';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Empty } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The one screen a supervisor opens most days.
 *
 * Filing the diary was three taps deep — My Sites, the site, the report tile —
 * behind a bottom bar that held a single link to the page you were already on.
 * This is what that space is for: the site you were last standing on, whether
 * today's report is in, and the two other things that get done on a phone at
 * the gate.
 *
 * It reads the site from `lastSiteId`, which SiteDetail writes on every visit.
 * With one site assigned there is nothing to choose and the question is never
 * asked.
 */

const dateLabel = new Intl.DateTimeFormat('en-KE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

function QuickAction({
  to,
  icon: Icon,
  label,
  hint,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  hint: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border border-hairline bg-surface p-3.5 shadow-sm transition-colors active:bg-surface-sunken"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-fg-muted">
        <Icon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-fg">{label}</span>
        <span className="block text-xs text-fg-subtle">{hint}</span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-fg-subtle" />
    </Link>
  );
}

export function TodayPage() {
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
  });

  const remembered = localStorage.getItem('lastSiteId');
  const site =
    projects?.find((p) => p.id === remembered) ?? (projects?.length === 1 ? projects[0] : undefined);

  // Only the chosen site's reports, and only to answer one question: is today's
  // in? The panel itself does the filing.
  const { data: reports } = useQuery({
    queryKey: ['daily-reports', site?.id],
    queryFn: () => api<DailyReport[]>(`/projects/${site!.id}/daily-reports`),
    enabled: !!site,
  });
  const today = todayISO();
  const filed = reports?.some((r) => r.date.slice(0, 10) === today);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }

  if (!projects?.length) {
    return (
      <Card>
        <CardContent>
          <Empty icon={Building2}>
            <p className="font-medium text-fg">No sites assigned yet</p>
            <p className="mt-1 max-w-xs text-fg-muted">
              Once an administrator assigns you to a site, today&rsquo;s work will show up here.
            </p>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  // More than one site and nothing remembered: ask once, then stop asking.
  if (!site || picking) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-fg">Which site today?</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {dateLabel.format(new Date())}. This screen will open here next time.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                localStorage.setItem('lastSiteId', p.id);
                setPicking(false);
                navigate('/today', { replace: true });
              }}
              className="flex items-center gap-3 rounded-xl border border-hairline bg-surface p-4 text-left shadow-sm transition-colors active:bg-surface-sunken"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-fg">{p.name}</span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-fg-muted">
                  <MapPin size={12} className="shrink-0" /> {p.location}
                </span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-fg-subtle" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-fg">Today</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{dateLabel.format(new Date())}</p>
      </div>

      <Card>
        <CardContent className="pt-4 sm:pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold text-fg">{site.name}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-fg-muted">
                <MapPin size={12} className="shrink-0" /> {site.location}
              </p>
            </div>
            {projects.length > 1 && (
              <button
                onClick={() => setPicking(true)}
                className="shrink-0 text-xs font-medium text-brand-700 hover:underline"
              >
                Change site
              </button>
            )}
          </div>

          {/* The whole reason this screen exists. */}
          <div className="mt-4 border-t border-hairline pt-4">
            {filed ? (
              <div className="flex items-start gap-2.5">
                <CheckCircle2 size={18} className="mt-px shrink-0 text-good-fg" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">Today&rsquo;s report is filed</p>
                  <Link
                    to={`/sites/${site.id}?view=report`}
                    className="text-xs font-medium text-brand-700 hover:underline"
                  >
                    Open it to add photos or correct something
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm font-medium text-fg">Today&rsquo;s report is not in yet</p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  The system already has the attendance, tasks and deliveries — it can write the
                  first draft for you.
                </p>
                <Link
                  to={`/sites/${site.id}?view=report`}
                  className={`${buttonVariants({ size: 'lg' })} mt-3 w-full`}
                >
                  <ClipboardList size={18} /> File today&rsquo;s report
                </Link>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <QuickAction
          to={`/sites/${site.id}?view=attendance`}
          icon={Fingerprint}
          label="Attendance"
          hint="Clock workers in and out"
        />
        <QuickAction
          to={`/sites/${site.id}?view=snags`}
          icon={AlertOctagon}
          label="Raise a defect"
          hint="Photograph it while you are there"
        />
      </div>

      <Link
        to={`/sites/${site.id}`}
        className={`${buttonVariants({ variant: 'outline' })} w-full`}
      >
        Everything else on this site
      </Link>
    </div>
  );
}
