import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Boxes,
  ChevronLeft,
  ClipboardList,
  Fingerprint,
  ListChecks,
  Receipt,
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

/**
 * Supervisor site home: five large action tiles instead of dense tabs.
 * Optimized for one-handed phone use on site — no financials here.
 */
const ACTIONS = [
  { id: 'attendance', label: 'Attendance', icon: Fingerprint, color: 'bg-brand-600' },
  { id: 'stock', label: 'Stock', icon: Boxes, color: 'bg-green-700' },
  { id: 'expenses', label: 'Expenses', icon: Receipt, color: 'bg-amber-600' },
  { id: 'tasks', label: 'Tasks', icon: ListChecks, color: 'bg-violet-700' },
  { id: 'report', label: 'Daily report', icon: ClipboardList, color: 'bg-slate-700' },
] as const;

type ActionId = (typeof ACTIONS)[number]['id'];

export function SiteDetailPage() {
  const { projectId = '' } = useParams();
  const [view, setView] = useState<ActionId | null>(null);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<Project>(`/projects/${projectId}`),
  });

  if (!project) return <p className="text-sm text-slate-500">Loading site…</p>;

  return (
    <div className="space-y-4">
      <div>
        {view ? (
          <button
            onClick={() => setView(null)}
            className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500"
          >
            <ChevronLeft size={16} /> {project.name}
          </button>
        ) : (
          <Link
            to="/sites"
            className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500"
          >
            <ChevronLeft size={16} /> My Sites
          </Link>
        )}
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-900">
            {view ? ACTIONS.find((a) => a.id === view)?.label : project.name}
          </h1>
          {!view && <StatusBadge status={project.status} />}
        </div>
        {!view && <p className="text-sm text-slate-500">{project.location}</p>}
      </div>

      {!view && (
        <div className="grid grid-cols-2 gap-3">
          {ACTIONS.map(({ id, label, icon: Icon, color }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={cn(
                'flex min-h-[110px] flex-col items-center justify-center gap-2 rounded-2xl p-4 text-white shadow-sm transition-transform active:scale-95',
                color,
              )}
            >
              <Icon size={30} />
              <span className="text-sm font-semibold">{label}</span>
            </button>
          ))}
        </div>
      )}

      {view === 'attendance' && <AttendancePanel projectId={projectId} />}
      {view === 'stock' && <StockPanel projectId={projectId} />}
      {view === 'expenses' && <ExpensesPanel projectId={projectId} />}
      {view === 'tasks' && <TasksPanel projectId={projectId} />}
      {view === 'report' && <ReportsPanel projectId={projectId} canSubmit />}
    </div>
  );
}
