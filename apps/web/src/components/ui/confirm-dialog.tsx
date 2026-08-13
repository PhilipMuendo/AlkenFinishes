import { Dialog } from './dialog';
import { Button } from './button';

/** A one-step "are you sure" for a destructive action, matching the weight
 * every other confirmation in this app already gets (a dialog with its own
 * title), rather than a native `confirm()` popup or a silent single click. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = 'Delete',
  onConfirm,
  pending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
  error?: string | null;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="space-y-3">
        {description && <p className="text-sm text-fg-muted">{description}</p>}
        {error && <p className="text-sm text-danger-fg">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="flex-1"
            disabled={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
