import { NavLink, Outlet } from 'react-router-dom';
import { Building2, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

/**
 * Mobile-first supervisor shell: simple top bar + bottom navigation with
 * large touch targets. Supervisors mostly work one-handed on site.
 */
export function SupervisorLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 pb-20">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <div>
            <p className="text-sm font-semibold leading-tight text-slate-900">AlkenFinishes</p>
            <p className="text-xs leading-tight text-slate-500">{user?.name}</p>
          </div>
        </div>
        <button
          onClick={() => void logout()}
          aria-label="Sign out"
          className="rounded-lg p-2.5 text-slate-500 hover:bg-slate-100"
        >
          <LogOut size={20} />
        </button>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <NavLink
          to="/sites"
          className={({ isActive }) =>
            cn(
              'flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium',
              isActive ? 'text-brand-700' : 'text-slate-500',
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
