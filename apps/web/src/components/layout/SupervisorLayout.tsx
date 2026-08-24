import { NavLink, Outlet } from 'react-router-dom';
import { Building2, CalendarCheck, LogOut, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Wordmark } from '@/components/Wordmark';
import { ConnectionBar } from '@/components/ConnectionBar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CommandPalette, useCommandPalette } from '@/components/CommandPalette';
import { NotificationBell } from '@/components/NotificationBell';
import { Toaster } from '@/components/ui/toast';
import { Assistant } from '@/features/Assistant';

/**
 * Mobile-first supervisor shell: simple top bar + bottom navigation with
 * large touch targets. Supervisors mostly work one-handed on site.
 */
function initials(name?: string) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function SupervisorLayout() {
  const { user, logout } = useAuth();
  const palette = useCommandPalette();
  return (
    <div className="flex min-h-screen flex-col bg-surface-muted pb-20">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-hairline bg-surface/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <Wordmark className="text-[15px]" />
        </div>
        <div className="flex items-center gap-1.5">
          {/* Supervisors had no search at all — only two bottom-bar links and
              whatever was on the screen. The palette is scoped by the server to
              what this user may see, so it is safe to hand them the same one. */}
          <button
            onClick={() => palette.setOpen(true)}
            aria-label="Search"
            className="rounded-lg p-2 text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg"
          >
            <Search size={20} />
          </button>
          <NotificationBell />
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
            {initials(user?.name)}
          </div>
          <button
            onClick={() => void logout()}
            aria-label="Sign out"
            className="rounded-lg p-2 text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <ConnectionBar />
      {/* max-w-7xl, not 5xl: CommandCentrePanel's card grid switches to four
          columns at the xl viewport breakpoint regardless of container width,
          so a narrower cap here left each card too tight for its own title
          ("Progress against programme" truncating mid-word). Matches
          AdminLayout's width so the same grid behaves the same in both. */}
      <main className="mx-auto w-full max-w-2xl flex-1 p-4 lg:max-w-7xl lg:p-6">
        <ErrorBoundary label="This page">
          <Outlet />
        </ErrorBoundary>
      </main>
      {/* A bottom bar costs ~56px of a phone screen permanently, so it has to
          carry more than a link to the page you are already on. Today is the
          one a supervisor opens most days; My Sites is for the rest. */}
      <nav className="fixed inset-x-0 bottom-0 grid grid-cols-2 border-t border-hairline bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        {[
          { to: '/today', label: 'Today', icon: CalendarCheck },
          { to: '/sites', label: 'My Sites', icon: Building2 },
        ].map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors',
                isActive ? 'text-brand-700' : 'text-fg-subtle',
              )
            }
          >
            <Icon size={22} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Supervisors get the same assistant; what it will answer is decided by
          the server from who is asking, not by hiding the button. */}
      <CommandPalette open={palette.open} onClose={() => palette.setOpen(false)} />
      <Assistant office={false} />
      <Toaster aboveNav />
    </div>
  );
}
