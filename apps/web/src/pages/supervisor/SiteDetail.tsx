import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertOctagon,
  BarChart3,
  Boxes,
  CalendarRange,
  Camera,
  CheckSquare,
  ChevronLeft,
  ClipboardCheck,
  ClipboardList,
  Fingerprint,
  HardHat,
  ListChecks,
  Receipt,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/badge';
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
import { PhotosPanel } from '@/features/PhotosPanel';
import { CommandCentrePanel } from '@/features/CommandCentrePanel';
import { WeeklyProgressPanel } from '@/features/WeeklyProgressPanel';
import { QualityInspectionPanel } from '@/features/QualityInspectionPanel';
import { HandoverPanel } from '@/features/HandoverPanel';

/**
 * Supervisor site home: large action tiles instead of dense tabs.
 * Optimized for one-handed phone use on site — no financials here.
 *
 * Every tile carries the same neutral chip. They used to carry eleven
 * different colours, two of them borrowed from the status palette — so
 * Expenses sat permanently amber and Safety permanently red whether or not
 * anything was wrong. Amber and red mean something in this app; spending them
 * on navigation leaves a real warning competing with a menu.
 */
const CHIP = 'bg-surface-sunken text-fg-muted';

/**
 * The 14 tiles above, grouped so the grid reads as sections instead of one
 * undifferentiated wall — same tiles, same routes, same `setView` behaviour,
 * just organised. Every id here must exist in `ACTIONS` below.
 */
const GROUPS: { title: string; ids: ActionId[] }[] = [
  { title: 'Daily operations', ids: ['fundis', 'attendance', 'tasks', 'report', 'photos'] },
  { title: 'Site management', ids: ['stock', 'expenses', 'tools', 'quality'] },
  { title: 'Reporting', ids: ['weekly', 'weekly-progress', 'handover'] },
  { title: 'Issues & safety', ids: ['snags', 'safety'] },
];

const ACTIONS = [
  { id: 'fundis', label: 'Fundis', hint: 'Add and manage fundis', icon: HardHat, chip: CHIP },
  {
    id: 'attendance',
    label: 'Attendance',
    hint: 'Clock fundis in',
    icon: Fingerprint,
    chip: CHIP,
  },
  { id: 'stock', label: 'Stock', hint: 'Materials on site', icon: Boxes, chip: CHIP },
  { id: 'expenses', label: 'Expenses', hint: 'Log spending', icon: Receipt, chip: CHIP },
  { id: 'tasks', label: 'Tasks', hint: 'Track progress', icon: ListChecks, chip: CHIP },
  {
    id: 'report',
    label: 'Daily report',
    hint: "Submit today's update",
    icon: ClipboardList,
    chip: CHIP,
  },
  {
    id: 'weekly',
    label: 'Weekly report',
    hint: 'Summarise the week',
    icon: CalendarRange,
    chip: CHIP,
  },
  {
    id: 'weekly-progress',
    label: 'Weekly Progress',
    hint: 'Planned vs Actual',
    icon: BarChart3,
    chip: CHIP,
  },
  { id: 'tools', label: 'Equipment', hint: 'What is on site right now', icon: Wrench, chip: CHIP },
  { id: 'photos', label: 'Photos', hint: 'Site photo gallery', icon: Camera, chip: CHIP },
  {
    id: 'quality',
    label: 'Quality Inspection',
    hint: 'Run the checklist',
    icon: ClipboardCheck,
    chip: CHIP,
  },
  {
    id: 'snags',
    label: 'Snag list',
    hint: 'Report a defect',
    icon: AlertOctagon,
    chip: CHIP,
  },
  {
    id: 'safety',
    label: 'Safety',
    hint: 'Log an incident',
    icon: ShieldAlert,
    chip: CHIP,
  },
  {
    id: 'handover',
    label: 'Handover',
    hint: 'Sign-off checklist',
    icon: CheckSquare,
    chip: CHIP,
  },
] as const;

type ActionId = (typeof ACTIONS)[number]['id'];

const ACTION_IDS = new Set<string>(ACTIONS.map((a) => a.id));

export function SiteDetailPage() {
  const { projectId = '' } = useParams();
  // The open panel lives in the URL so Today can link straight to the daily
  // report, and so the phone's back button leaves the panel rather than the
  // site.
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const view = requested && ACTION_IDS.has(requested) ? (requested as ActionId) : null;

  const setView = (id: ActionId | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('view', id);
    else next.delete('view');
    // A push, not a replace: opening a panel is a place you can come back
    // from, so the phone's back button closes it instead of leaving the site
    // entirely. That is the gesture a supervisor reaches for one-handed.
    setParams(next);
  };

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<Project>(`/projects/${projectId}`),
  });

  // Remembered so Today can open on the site you were last standing on.
  useEffect(() => {
    if (projectId) localStorage.setItem('lastSiteId', projectId);
  }, [projectId]);

  if (!project) return <SiteSkeleton />;

  return (
    <div className="space-y-4">
      <div>
        {view ? (
          <button
            onClick={() => setView(null)}
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
          >
            <ChevronLeft size={16} /> {project.name}
          </button>
        ) : (
          <Link
            to="/sites"
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
          >
            <ChevronLeft size={16} /> My Sites
          </Link>
        )}
        <div className="flex items-center justify-between gap-2">
          <h1 className="truncate text-xl font-semibold tracking-tight text-fg">
            {view ? ACTIONS.find((a) => a.id === view)?.label : project.name}
          </h1>
          {!view && <StatusBadge status={project.status} />}
        </div>
        {!view && (
          <p className="mt-0.5 text-sm text-fg-muted">{project.location} · Site overview</p>
        )}
      </div>

      {/* The same control room the office sees, minus the money — the server
          omits the financial sections for a supervisor, so nothing is being
          hidden client-side here. */}
      {!view && <CommandCentrePanel projectId={projectId} linked={false} />}

      {!view && (
        <div className="space-y-5">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                {group.title}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {group.ids.map((id) => {
                  const { label, hint, icon: Icon, chip } = ACTIONS.find((a) => a.id === id)!;
                  return (
                    <button
                      key={id}
                      onClick={() => setView(id)}
                      className="flex min-h-[112px] flex-col items-start gap-3 rounded-2xl border border-hairline bg-surface p-4 text-left shadow-sm transition-all hover:border-hairline-strong hover:shadow-md active:scale-[0.98] active:bg-surface-sunken"
                    >
                      <span className={cn('flex h-11 w-11 items-center justify-center rounded-xl', chip)}>
                        <Icon size={22} />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-fg">{label}</span>
                        <span className="block text-xs text-fg-subtle">{hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
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
      {view === 'weekly-progress' && <WeeklyProgressPanel projectId={projectId} />}
      {view === 'tools' && <ToolsReadOnlyPanel />}
      {view === 'photos' && <PhotosPanel projectId={projectId} />}
      {view === 'quality' && <QualityInspectionPanel projectId={projectId} />}
      {view === 'snags' && <SnagsPanel projectId={projectId} />}
      {view === 'safety' && <SafetyPanel projectId={projectId} />}
      {view === 'handover' && <HandoverPanel projectId={projectId} />}
    </div>
  );
}

/** Matches the shape of the loaded page, rather than a bare line of text. */
function SiteSkeleton() {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2.5 h-6 w-2/5" />
        <Skeleton className="mt-2 h-3.5 w-1/3" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[112px] rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
