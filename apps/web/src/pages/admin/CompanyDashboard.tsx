import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, Building2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Project, ProjectStatus } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { Empty } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { ProjectCard } from '@/components/ProjectCard';

// The landing page is a portfolio at a glance — projects only, grouped by
// lifecycle stage. All the numbers (budget, payments, health, charts) live
// inside each project, not here.
const SECTIONS: { key: ProjectStatus; label: string; hint: string }[] = [
  { key: 'ACTIVE', label: 'Ongoing', hint: 'Live sites in progress' },
  { key: 'PLANNING', label: 'About to start', hint: 'Awaiting kickoff' },
  { key: 'ON_HOLD', label: 'On hold', hint: 'Paused sites' },
  { key: 'COMPLETED', label: 'Completed', hint: 'Delivered projects' },
];

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <PageHeader title="Overview" description="Your projects at a glance" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function CompanyDashboard() {
  const { data: projects, isError, isLoading, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<Project[]>('/projects'),
  });

  if (isLoading) return <DashboardSkeleton />;

  if (isError || !projects) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description="Your projects at a glance" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle size={20} />
            </div>
            <div>
              <p className="font-medium text-fg">Couldn&rsquo;t load your projects</p>
              <p className="mt-1 text-sm text-fg-muted">Check your connection and try again.</p>
            </div>
            <button
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
              onClick={() => void refetch()}
            >
              Retry
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Cancelled projects stay out of the portfolio view.
  const visible = projects.filter((p) => p.status !== 'CANCELLED');
  const activeCount = visible.filter((p) => p.status === 'ACTIVE').length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description={
          visible.length
            ? `${activeCount} active · ${visible.length} in portfolio`
            : 'Your projects at a glance'
        }
      />

      {visible.length === 0 ? (
        <Card>
          <CardContent>
            <Empty icon={Building2}>
              <p className="font-medium text-fg">No projects yet</p>
              <p className="mt-1 max-w-xs text-fg-muted">
                Create your first project to start tracking budgets, payments, and progress.
              </p>
              <Link to="/admin/projects" className={buttonVariants({ className: 'mt-3' })}>
                Create a project
              </Link>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {SECTIONS.map(({ key, label, hint }) => {
            const group = visible.filter((p) => p.status === key);
            if (group.length === 0) return null;
            return (
              <section key={key}>
                <div className="mb-3 flex items-baseline gap-2.5">
                  <h2 className="text-sm font-semibold tracking-tight text-fg">{label}</h2>
                  <span className="nums rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-fg-muted">
                    {group.length}
                  </span>
                  <span className="text-xs text-fg-subtle">{hint}</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.map((p) => (
                    <ProjectCard key={p.id} project={p} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
