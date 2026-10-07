import { Dialog } from './Dialog';

/**
 * Confirmations are reserved for irreversible actions: delete forever, deleting
 * a tag, replacing the journal on import, removing a ? flag from a solved question.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={message}>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn tap"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`btn tap ${danger ? 'border-danger text-danger' : 'btn-primary'}`}
          onClick={() => {
            onConfirm();
            onOpenChange(false);
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
