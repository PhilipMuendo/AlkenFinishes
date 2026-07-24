import { NavLink, Outlet } from 'react-router-dom';
import { Building2, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Wordmark } from '@/components/Wordmark';

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
  return (
    <div className="flex min-h-screen flex-col bg-surface-muted pb-20">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-hairline bg-surface/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <Wordmark className="text-[15px]" />
        </div>
        <div className="flex items-center gap-2.5">
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
      <main className="mx-auto w-full max-w-2xl flex-1 p-4 lg:max-w-5xl lg:p-6">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 border-t border-hairline bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <NavLink
          to="/sites"
          className={({ isActive }) =>
            cn(
              'flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors',
              isActive ? 'text-brand-700' : 'text-fg-subtle',
            )
          }
        >
          <Building2 size={22} />
          My Sites
        </NavLink>
      </nav>
    </div>
  );
}
