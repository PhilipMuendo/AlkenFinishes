import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { fmtDate, fmtTime } from '@/lib/format';
import type { AppNotification, NotificationType } from '@/lib/types';
import { Empty } from '@/components/ui/table';

/**
 * Where clicking a notification sends you — the one place that can actually
 * do something about it. Money-related types are superadmin-only wherever
 * they appear (the API never offers them to a supervisor), so the office
 * paths are the only ones that matter there; SYNC_ISSUE is the one type a
 * supervisor can also receive, hence the role branch.
 */
function targetHref(n: AppNotification, isOffice: boolean): string | null {
  switch (n.type as NotificationType) {
    case 'SYNC_ISSUE':
      return isOffice ? '/admin/settings/attendance' : n.projectId ? `/sites/${n.projectId}` : null;
    case 'BUDGET_OVER_THRESHOLD':
    case 'PAYMENT_OVERDUE':
      return n.projectId ? `/admin/sites/${n.projectId}` : null;
    case 'INVOICE_OVERDUE':
      return '/admin/receivables';
    case 'CONTRACT_AWAITING_SIGNATURE':
      return '/admin/contracts';
    default:
      return null;
  }
}

/**
 * The bell shared by both shells. Unread count polls on its own short
 * interval so the badge stays close to live without a websocket; the list
 * itself only fetches once the panel is actually opened.
 */
export function NotificationBell({ className }: { className?: string }) {
  const { user } = useAuth();
  const isOffice = user?.role === 'SUPERADMIN';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api<AppNotification[]>('/notifications'),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const markAllRead = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: invalidate,
  });

  const count = unread?.count ?? 0;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative rounded-lg p-2 text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg"
      >
        <Bell size={20} />
        {count > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-fg px-1 text-[10px] font-semibold leading-none text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        // Fixed to the viewport's top-right corner rather than anchored under
        // the bell itself — in AdminLayout the bell sits in the top-LEFT
        // sidebar, and a panel dropping from there ran down over the nav.
        <div className="fixed right-3 top-16 z-30 max-h-[28rem] w-[calc(100vw-1.5rem)] max-w-80 overflow-hidden rounded-lg border border-hairline bg-surface shadow-md sm:right-4 sm:max-w-96">
          <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
            <p className="text-sm font-medium text-fg">Notifications</p>
            {notifications && notifications.some((n) => !n.readAt) && (
              <button
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[24rem] overflow-y-auto">
            {isLoading && <p className="p-4 text-sm text-fg-subtle">Loading…</p>}
            {!isLoading && notifications?.length === 0 && (
              <Empty variant="inline" icon={Bell}>Nothing needs attention right now</Empty>
            )}
            {notifications?.map((n) => {
              const href = targetHref(n, isOffice);
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.readAt) markRead.mutate(n.id);
                    setOpen(false);
                    if (href) navigate(href);
                  }}
                  className={cn(
                    'block w-full border-b border-hairline px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-sunken',
                    !n.readAt && 'bg-brand-50/60',
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!n.readAt && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg">{n.title}</p>
                      <p className="mt-0.5 text-xs text-fg-muted">{n.body}</p>
                      <p className="mt-1 text-[11px] text-fg-subtle">
                        {n.project ? `${n.project.name} · ` : ''}
                        {fmtDate(n.lastSeenAt)} {fmtTime(n.lastSeenAt)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
