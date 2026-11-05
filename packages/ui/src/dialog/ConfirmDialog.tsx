import { useId, useRef, useState } from 'react';
import { useModal } from './useModal';

export interface ConfirmDialogProps {
  /** Short heading; it is the dialog's accessible name. Name the item in it. */
  title: string;
  /** The full question, shown and exposed as the accessible description. */
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm(): void | Promise<void>;
  onCancel(): void;
}

/**
 * A modal alertdialog. Render it only while it is open (mount = open, unmount = closed): focus
 * starts on Cancel, Tab is trapped, Esc cancels, and focus returns to the opener on unmount.
 * While `onConfirm` is pending both buttons are disabled so it cannot fire twice.
 */
export function ConfirmDialog(p: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const descId = useId();
  const { ref, onKeyDown } = useModal(p.onCancel, cancelRef);
  const confirm = async () => {
    setBusy(true);
    try {
      await p.onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && p.onCancel()}
    >
      <div
        ref={ref}
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{p.title}</h2>
        <p id={descId}>{p.description}</p>
        <div className="modal-actions">
          <button type="button" ref={cancelRef} disabled={busy} onClick={p.onCancel}>
            {p.cancelLabel ?? 'Cancel'}
          </button>
          <button type="button" className="danger" disabled={busy} onClick={() => void confirm()}>
            {p.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
