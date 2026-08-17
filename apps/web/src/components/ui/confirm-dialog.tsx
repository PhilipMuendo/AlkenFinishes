import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormError } from '@/components/ui/form-error';

/**
 * The step between clicking a destructive control and it happening.
 *
 * Several places used to delete on a single click, with no confirmation and
 * nothing to undo — on financial records, which is where that is least
 * affordable. This names the specific thing being deleted, because "Are you
 * sure?" on its own tells you nothing about what you are about to lose.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Delete',
  pending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  /** What is being acted on, and what the consequence is. */
  body: React.ReactNode;
  confirmLabel?: string;
  pending?: boolean;
  error?: unknown;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} className="max-w-md">
      <div className="space-y-4">
        <div className="text-sm text-fg-muted">{body}</div>
        <FormError error={error} fallback="That didn’t work. Nothing was changed." />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
