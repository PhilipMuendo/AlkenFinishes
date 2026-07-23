import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight, MapPin, Building2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Project } from '@/lib/types';
import { StatusBadge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Empty } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

export function MySitesPage() {
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-fg">My Sites</h1>
        <p className="mt-0.5 text-sm text-fg-muted">Tap a site to log today&rsquo;s work.</p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-hairline bg-surface p-4 shadow-sm">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-2 h-3 w-3/5" />
              <Skeleton className="mt-3 h-1.5 w-full" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && projects?.length === 0 && (
        <div className="rounded-xl border border-hairline bg-surface shadow-sm">
          <Empty icon={Building2}>
            <p className="font-medium text-fg">No sites assigned yet</p>
            <p className="mt-1 max-w-xs text-fg-muted">
              Once an administrator assigns you to a site, it&rsquo;ll appear here.
            </p>
          </Empty>
        </div>
      )}

      <div className="space-y-3">
        {projects?.map((p) => (
          <Link
            key={p.id}
            to={`/sites/${p.id}`}
            className="flex items-center gap-3 rounded-xl border border-hairline bg-surface p-4 shadow-sm transition-colors active:bg-surface-sunken"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-semibold text-fg">{p.name}</p>
                <StatusBadge status={p.status} />
              </div>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-fg-muted">
                <MapPin size={12} className="shrink-0" /> {p.location}
              </p>
              <div className="mt-2.5 flex items-center gap-2.5">
                <Progress value={p.progressPct} className="flex-1" />
                <span className="nums text-xs font-medium text-fg-muted">{p.progressPct}%</span>
              </div>
            </div>
            <ChevronRight size={20} className="shrink-0 text-fg-subtle" />
          </Link>
        ))}
      </div>
    </div>
  );
}
