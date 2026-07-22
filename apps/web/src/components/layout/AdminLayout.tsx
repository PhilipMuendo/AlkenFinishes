import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3,
  Building2,
  HardHat,
  LogOut,
  Menu,
  Settings,
  Users,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

const nav = [
  { to: '/admin', label: 'Dashboard', icon: BarChart3, end: true },
  { to: '/admin/projects', label: 'Projects', icon: Building2 },
  { to: '/admin/workers', label: 'Workers', icon: HardHat },
  { to: '/admin/tools', label: 'Tools', icon: Wrench },
  { to: '/admin/users', label: 'Team', icon: Users },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
];

export function AdminLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const links = (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {nav.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-brand-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white',
            )
          }
        >
          <Icon size={18} />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 flex-col bg-slate-900 lg:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <span className="text-lg font-semibold text-white">AlkenFinishes</span>
        </div>
        {links}
        <div className="border-t border-slate-800 p-3">
          <p className="px-3 pb-2 text-xs text-slate-400">{user?.name}</p>
          <button
            onClick={() => void logout()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="font-semibold text-slate-900">AlkenFinishes</span>
          </div>
          <button
            aria-label="Menu"
            onClick={() => setOpen(!open)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
          >
            <Menu size={22} />
          </button>
        </header>
        {open && (
          <div className="border-b border-slate-800 bg-slate-900 lg:hidden">
            {links}
            <button
              onClick={() => void logout()}
              className="flex w-full items-center gap-3 px-6 py-3 text-sm text-slate-300"
            >
              <LogOut size={18} /> Sign out
            </button>
          </div>
        )}
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
