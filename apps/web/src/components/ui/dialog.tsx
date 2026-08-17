import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn, focusRing } from '@/lib/utils';

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
    // Click-on-the-backdrop to dismiss. There is no keyboard equivalent to add
    // here: a native <dialog> already closes on Escape, which fires the `close`
    // event and so runs `onClose` below.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg flex-col rounded-2xl border border-hairline bg-surface p-0 text-fg shadow-lg backdrop:bg-scrim/40 backdrop:backdrop-blur-[2px] open:animate-fade-in',
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-hairline px-5 py-4">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className={cn(
            '-mr-1 rounded-lg p-1.5 text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg',
            focusRing,
          )}
        >
          <X size={18} />
        </button>
      </div>
      <div className="overflow-y-auto p-5">{children}</div>
    </dialog>
  );
}
