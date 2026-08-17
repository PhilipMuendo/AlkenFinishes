import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardList,
  Contact,
  FileSignature,
  FileText,
  HardHat,
  LogOut,
  Menu,
  ReceiptText,
  Settings,
  Target,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { cn, focusRing } from '@/lib/utils';
import { Wordmark } from '@/components/Wordmark';
import { OfflineBanner } from '@/components/OfflineBanner';

/**
 * Grouped in the order work actually moves through the business: win it, agree
 * it, run it, get paid for it. Without the headings this is thirteen
 * undifferentiated links, which is where a sidebar stops being navigable.
 */
type NavEntry =
  { heading: string } | { to: string; label: string; icon: LucideIcon; end?: boolean };

const nav: NavEntry[] = [
  { to: '/admin', label: 'Overview', icon: BarChart3, end: true },
  { heading: 'Winning work' },
  { to: '/admin/clients', label: 'Clients', icon: Contact },
  { to: '/admin/leads', label: 'Leads', icon: Target },
  { to: '/admin/quotations', label: 'Quotations', icon: FileText },
  { to: '/admin/contracts', label: 'Contracts', icon: FileSignature },
  { heading: 'On site' },
  { to: '/admin/projects', label: 'Projects', icon: Building2 },
  { to: '/admin/workers', label: 'Workers', icon: HardHat },
  { to: '/admin/tools', label: 'Tools', icon: Wrench },
  { to: '/admin/reports', label: 'Reports', icon: ClipboardList },
  { to: '/admin/calendar', label: 'Calendar', icon: CalendarDays },
  { heading: 'Money' },
  { to: '/admin/invoices', label: 'Receivables', icon: ReceiptText },
  { heading: 'Admin' },
  { to: '/admin/users', label: 'Team', icon: Users },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
];

function initials(name?: string) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3">
      {nav.map((item, i) =>
        'heading' in item ? (
          <p
            key={item.heading}
            className={cn(
              'px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle',
              i === 0 ? 'pt-1' : 'pt-4',
            )}
          >
            {item.heading}
          </p>
        ) : (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                focusRing,
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  size={18}
                  className={cn(
                    'shrink-0',
                    isActive ? 'text-brand-600' : 'text-fg-subtle group-hover:text-fg-muted',
                  )}
                />
                {item.label}
              </>
            )}
          </NavLink>
        ),
      )}
    </nav>
  );
}

function UserFooter({ name, onSignOut }: { name?: string; onSignOut: () => void }) {
  return (
    <div className="border-t border-hairline p-3">
      <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
          {initials(name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">{name}</p>
          <p className="truncate text-xs text-fg-subtle">Administrator</p>
        </div>
        <button
          onClick={onSignOut}
          aria-label="Sign out"
          className={cn(
            'rounded-lg p-1.5 text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg',
            focusRing,
          )}
        >
          <LogOut size={16} />
        </button>
      </div>
    </div>
  );
}

export function AdminLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-surface-muted">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-hairline bg-surface lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-[18px]">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <Wordmark className="text-[15px]" />
        </div>
        <NavItems />
        <UserFooter name={user?.name} onSignOut={() => void logout()} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        {/* Mobile header */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-hairline bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <Wordmark />
          </div>
          <button
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className={cn(
              'rounded-lg p-2 text-fg-muted transition-colors hover:bg-surface-sunken',
              focusRing,
            )}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </header>

        {/* Mobile drawer */}
        {open && (
          <>
            <button
              aria-label="Close menu"
              className="fixed inset-0 z-30 bg-scrim/40 backdrop-blur-[2px] lg:hidden"
              onClick={() => setOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 z-40 flex w-72 max-w-[80vw] animate-fade-in flex-col border-r border-hairline bg-surface shadow-lg lg:hidden">
              <div className="flex items-center gap-2.5 px-5 py-[18px]">
                <img src="/favicon.svg" alt="" className="h-8 w-8" />
                <Wordmark className="text-[15px]" />
              </div>
              <NavItems onNavigate={() => setOpen(false)} />
              <UserFooter name={user?.name} onSignOut={() => void logout()} />
            </div>
          </>
        )}

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
