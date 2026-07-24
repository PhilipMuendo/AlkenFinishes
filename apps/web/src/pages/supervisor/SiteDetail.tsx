import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Boxes,
  CalendarRange,
  ChevronLeft,
  ClipboardList,
  Fingerprint,
  ListChecks,
  Receipt,
  Wrench,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/badge';
import { TasksPanel } from '@/features/TasksPanel';
import { ExpensesPanel } from '@/features/ExpensesPanel';
import { AttendancePanel } from '@/features/AttendancePanel';
import { StockPanel } from '@/features/StockPanel';
import { ReportsPanel } from '@/features/ReportsPanel';
import { WeeklyReportsPanel } from '@/features/WeeklyReportsPanel';
import { ToolsReadOnlyPanel } from '@/features/ToolsReadOnlyPanel';

/**
 * Supervisor site home: large action tiles instead of dense tabs.
 * Optimized for one-handed phone use on site — no financials here.
 */
const ACTIONS = [
  {
    id: 'attendance',
    label: 'Attendance',
    hint: 'Clock workers in',
    icon: Fingerprint,
    chip: 'bg-brand-50 text-brand-600',
  },
  { id: 'stock', label: 'Stock', hint: 'Materials on site', icon: Boxes, chip: 'bg-emerald-50 text-emerald-600' },
  { id: 'expenses', label: 'Expenses', hint: 'Log spending', icon: Receipt, chip: 'bg-amber-50 text-amber-600' },
  { id: 'tasks', label: 'Tasks', hint: 'Track progress', icon: ListChecks, chip: 'bg-violet-50 text-violet-600' },
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
  { id: 'tools', label: 'Tools', hint: 'Equipment on site', icon: Wrench, chip: 'bg-teal-50 text-teal-600' },
] as const;

type ActionId = (typeof ACTIONS)[number]['id'];

export function SiteDetailPage() {
  const { projectId = '' } = useParams();
  const [view, setView] = useState<ActionId | null>(null);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<Project>(`/projects/${projectId}`),
  });

  if (!project) return <p className="text-sm text-fg-muted">Loading site…</p>;

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
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-fg">
            {view ? ACTIONS.find((a) => a.id === view)?.label : project.name}
          </h1>
          {!view && <StatusBadge status={project.status} />}
        </div>
        {!view && <p className="mt-0.5 text-sm text-fg-muted">{project.location}</p>}
      </div>

      {!view && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {ACTIONS.map(({ id, label, hint, icon: Icon, chip }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className="flex min-h-[112px] flex-col items-start gap-3 rounded-2xl border border-hairline bg-surface p-4 text-left shadow-sm transition-all active:scale-[0.98] active:bg-surface-sunken"
            >
              <span className={cn('flex h-11 w-11 items-center justify-center rounded-xl', chip)}>
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

      {view === 'attendance' && <AttendancePanel projectId={projectId} />}
      {view === 'stock' && <StockPanel projectId={projectId} />}
      {view === 'expenses' && <ExpensesPanel projectId={projectId} />}
      {view === 'tasks' && <TasksPanel projectId={projectId} />}
      {view === 'report' && <ReportsPanel projectId={projectId} canSubmit />}
      {view === 'weekly' && <WeeklyReportsPanel projectId={projectId} canSubmit />}
      {view === 'tools' && <ToolsReadOnlyPanel />}
    </div>
  );
}
