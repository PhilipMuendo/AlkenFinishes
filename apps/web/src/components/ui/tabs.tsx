import { cn } from '@/lib/utils';

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-px"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors',
            active === t.id
              ? 'border-b-2 border-brand-600 text-brand-700'
              : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
