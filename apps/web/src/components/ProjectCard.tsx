import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { ProjectStatus } from '@/lib/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { StatusBadge } from '@/components/ui/badge';
import { projectStatusTone } from '@/lib/tone';
import { Progress } from '@/components/ui/progress';
import { cn, focusRingOnMuted } from '@/lib/utils';

export interface ProjectCardData {
  id: string;
  name: string;
  clientName: string;
  location: string;
  contractValue: number | string;
  startDate: string;
  expectedCompletion: string;
  status: ProjectStatus;
  progressPct: number;
  supervisor: { name: string } | null;
}

export function ProjectCard({
  project,
  extra,
}: {
  project: ProjectCardData;
  extra?: React.ReactNode;
}) {
  return (
    <Link
      to={`/admin/projects/${project.id}`}
      className={cn(
        'group flex h-full flex-col rounded-xl border border-hairline bg-surface p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-hairline-strong hover:shadow-md',
        focusRingOnMuted,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-fg">{project.name}</p>
          <p className="mt-0.5 truncate text-xs text-fg-muted">
            {project.clientName} · {project.location}
          </p>
        </div>
        <StatusBadge status={project.status} tones={projectStatusTone} />
      </div>

      <p className="nums mt-3 text-lg font-semibold tracking-tight text-fg">
        {fmtMoney(Number(project.contractValue))}
      </p>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-fg-subtle">Completion</span>
          <span className="nums font-medium text-fg-muted">{project.progressPct}%</span>
        </div>
        <Progress value={project.progressPct} />
      </div>

      <p className="mt-3 text-xs text-fg-subtle">
        {fmtDate(project.startDate)} → {fmtDate(project.expectedCompletion)}
        {' · '}
        {project.supervisor?.name ?? 'No supervisor'}
      </p>

      {extra}

      <div className="mt-3 flex items-center gap-1 pt-1 text-xs font-medium text-brand-600 opacity-0 transition-opacity group-hover:opacity-100">
        View project <ArrowRight size={13} />
      </div>
    </Link>
  );
}
