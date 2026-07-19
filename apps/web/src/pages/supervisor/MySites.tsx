import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight, MapPin } from 'lucide-react';
import { api } from '@/lib/api';
import type { Project } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Empty } from '@/components/ui/table';

export function MySitesPage() {
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Loading your sites…</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-900">My Sites</h1>
      {projects?.length === 0 && (
        <Empty>No sites assigned to you yet. Contact your administrator.</Empty>
      )}
      <div className="space-y-3">
        {projects?.map((p) => (
          <Link key={p.id} to={`/sites/${p.id}`} className="block">
            <Card className="flex items-center gap-3 p-4 active:bg-slate-50">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold text-slate-900">{p.name}</p>
                  <StatusBadge status={p.status} />
                </div>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                  <MapPin size={12} /> {p.location}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Progress value={p.progressPct} health="GREEN" />
                  <span className="text-xs tabular-nums text-slate-600">{p.progressPct}%</span>
                </div>
              </div>
              <ChevronRight size={20} className="shrink-0 text-slate-400" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
