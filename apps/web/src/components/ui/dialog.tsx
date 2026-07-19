import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'w-full max-w-lg rounded-xl p-0 shadow-xl backdrop:bg-slate-900/50 open:animate-in',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
        >
          <X size={18} />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
