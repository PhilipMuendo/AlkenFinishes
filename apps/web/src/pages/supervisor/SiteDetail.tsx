import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertOctagon,
  Boxes,
  CalendarRange,
  ChevronLeft,
  ClipboardList,
  Fingerprint,
  HardHat,
  ListChecks,
  Receipt,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { Project } from '@/lib/types';
import { cn, focusRingOnMuted } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/badge';
import { projectStatusTone } from '@/lib/tone';
import { QueryState } from '@/components/ui/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TasksPanel } from '@/features/TasksPanel';
import { ExpensesPanel } from '@/features/ExpensesPanel';
import { AttendancePanel } from '@/features/AttendancePanel';
import { StockPanel } from '@/features/StockPanel';
import { ReportsPanel } from '@/features/ReportsPanel';
import { WeeklyReportsPanel } from '@/features/WeeklyReportsPanel';
import { ToolsReadOnlyPanel } from '@/features/ToolsReadOnlyPanel';
import { WorkersPanel } from '@/features/WorkersPanel';
import { SnagsPanel } from '@/features/SnagsPanel';
import { SafetyPanel } from '@/features/SafetyPanel';
import { CommandCentrePanel } from '@/features/CommandCentrePanel';

/**
 * Supervisor site home: large action tiles instead of dense tabs.
 * Optimized for one-handed phone use on site — no financials here.
 */
const ACTIONS = [
  {
    id: 'fundis',
    label: 'Fundis',
    hint: 'Add and manage fundis',
    icon: HardHat,
    chip: 'bg-rose-50 text-rose-600',
  },
  {
    id: 'attendance',
    label: 'Attendance',
    hint: 'Clock workers in',
    icon: Fingerprint,
    chip: 'bg-brand-50 text-brand-600',
  },
  {
    id: 'stock',
    label: 'Stock',
    hint: 'Materials on site',
    icon: Boxes,
    chip: 'bg-emerald-50 text-emerald-600',
  },
  {
    id: 'expenses',
    label: 'Expenses',
    hint: 'Log spending',
    icon: Receipt,
    chip: 'bg-amber-50 text-amber-600',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    hint: 'Track progress',
    icon: ListChecks,
    chip: 'bg-violet-50 text-violet-600',
  },
  {
    id: 'report',
    label: 'Daily report',
    hint: "Submit today's update",
    icon: ClipboardList,
    chip: 'bg-indigo-50 text-indigo-600',
  },
  {
    id: 'weekly',
    label: 'Weekly report',
    hint: 'Summarise the week',
    icon: CalendarRange,
    chip: 'bg-sky-50 text-sky-600',
  },
  {
    id: 'tools',
    label: 'Tools',
    hint: 'Equipment on site',
    icon: Wrench,
    chip: 'bg-teal-50 text-teal-600',
  },
  {
    id: 'snags',
    label: 'Snag list',
    hint: 'Report a defect',
    icon: AlertOctagon,
    chip: 'bg-orange-50 text-orange-600',
  },
  {
    id: 'safety',
    label: 'Safety',
    hint: 'Log an incident',
    icon: ShieldAlert,
    chip: 'bg-red-50 text-red-600',
  },
] as const;

type ActionId = (typeof ACTIONS)[number]['id'];

const ACTION_IDS = new Set<string>(ACTIONS.map((a) => a.id));

export function SiteDetailPage() {
  const { projectId = '' } = useParams();
  /**
   * The open action lives in the URL, not in state. On a phone — which is the
   * only place this page is used — the hardware back button is how people go
   * back, and with local state it would leave the site entirely instead of
   * returning to the tile grid.
   */
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const view: ActionId | null =
    requested && ACTION_IDS.has(requested) ? (requested as ActionId) : null;

  // A push, not a replace: each step should cost exactly one press to undo.
  const openView = (id: ActionId) => setParams({ view: id });
  const closeView = () => setParams({});

  const query = useQuery({
    queryKey: queryKeys.projects.detail(projectId),
    queryFn: () => api<Project>(`/projects/${projectId}`),
  });

  return (
    <QueryState query={query} errorTitle="Couldn’t load this site" skeleton={<SiteSkeleton />}>
      {(project) => (
        <div className="space-y-4">
          <div>
            {view ? (
              <button
                onClick={closeView}
                className={cn(
                  'mb-2 inline-flex items-center gap-1 rounded-lg text-sm font-medium text-fg-muted transition-colors hover:text-fg',
                  focusRingOnMuted,
                )}
              >
                <ChevronLeft size={16} /> {project.name}
              </button>
            ) : (
              <Link
                to="/sites"
                className={cn(
                  'mb-2 inline-flex items-center gap-1 rounded-lg text-sm font-medium text-fg-muted transition-colors hover:text-fg',
                  focusRingOnMuted,
                )}
              >
                <ChevronLeft size={16} /> My Sites
              </Link>
            )}
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-fg">
                {view ? ACTIONS.find((a) => a.id === view)?.label : project.name}
              </h1>
              {!view && <StatusBadge status={project.status} tones={projectStatusTone} />}
            </div>
            {!view && <p className="mt-0.5 text-sm text-fg-muted">{project.location}</p>}
          </div>

          {/* The same control room the office sees, minus the money — the server
          omits the financial sections for a supervisor, so nothing is being
          hidden client-side here. */}
          {!view && <CommandCentrePanel projectId={projectId} linked={false} />}

          {!view && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {ACTIONS.map(({ id, label, hint, icon: Icon, chip }) => (
                <button
                  key={id}
                  onClick={() => openView(id)}
                  className={cn(
                    'flex min-h-[112px] flex-col items-start gap-3 rounded-2xl border border-hairline bg-surface p-4 text-left shadow-sm transition-all active:scale-[0.98] active:bg-surface-sunken',
                    focusRingOnMuted,
                  )}
                >
                  <span
                    className={cn('flex h-11 w-11 items-center justify-center rounded-xl', chip)}
                  >
                    <Icon size={22} />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-fg">{label}</span>
                    <span className="block text-xs text-fg-subtle">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {view === 'fundis' && <WorkersPanel projectId={projectId} />}
          {view === 'attendance' && <AttendancePanel projectId={projectId} />}
          {view === 'stock' && <StockPanel projectId={projectId} />}
          {view === 'expenses' && <ExpensesPanel projectId={projectId} />}
          {view === 'tasks' && <TasksPanel projectId={projectId} />}
          {view === 'report' && <ReportsPanel projectId={projectId} canSubmit />}
          {view === 'weekly' && <WeeklyReportsPanel projectId={projectId} canSubmit />}
          {view === 'tools' && <ToolsReadOnlyPanel />}
          {view === 'snags' && <SnagsPanel projectId={projectId} />}
          {view === 'safety' && <SafetyPanel projectId={projectId} />}
        </div>
      )}
    </QueryState>
  );
}

function SiteSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-2/5" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
