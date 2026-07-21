import { Link } from 'react-router-dom';
import type { ProjectStatus } from '@/lib/types';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

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
    <Link to={`/admin/projects/${project.id}`}>
      <Card className="h-full p-4 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-slate-900">{project.name}</p>
            <p className="text-xs text-slate-500">
              {project.clientName} · {project.location}
            </p>
          </div>
          <StatusBadge status={project.status} />
        </div>
        <p className="mt-3 text-lg font-semibold tabular-nums text-slate-900">
          {fmtMoney(Number(project.contractValue))}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Progress value={project.progressPct} health="GREEN" />
          <span className="text-xs tabular-nums text-slate-600">{project.progressPct}%</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {fmtDate(project.startDate)} → {fmtDate(project.expectedCompletion)} ·{' '}
          {project.supervisor?.name ?? 'No supervisor'}
        </p>
        {extra}
      </Card>
    </Link>
  );
}
