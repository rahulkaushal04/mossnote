import * as RadixDialog from '@radix-ui/react-dialog';
import { useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required: the dialog is labelled by its title. */
  title: string;
  description?: string;
  children: ReactNode;
  /** `bottom` is a sheet that rises from the bottom edge on narrow screens (date picker). */
  placement?: 'center' | 'bottom' | 'right';
  /** Wider panel for the search palette and shortcut list. */
  className?: string;
}

const NARROW = {
  center: 'inset-0',
  bottom: 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-panel',
  right: 'inset-0',
} as const;

// Wide screens: centred panel, or a 420px sheet on the right edge (farm entry detail).
const WIDE = {
  center:
    'wide:inset-auto wide:top-1/2 wide:left-1/2 wide:max-h-[80vh] wide:w-[560px] wide:max-w-[calc(100vw-2rem)] wide:-translate-x-1/2 wide:-translate-y-1/2 wide:rounded-panel wide:shadow-float',
  bottom:
    'wide:inset-auto wide:top-1/2 wide:left-1/2 wide:max-h-[80vh] wide:w-[560px] wide:max-w-[calc(100vw-2rem)] wide:-translate-x-1/2 wide:-translate-y-1/2 wide:rounded-panel wide:shadow-float',
  right: 'wide:inset-y-0 wide:right-0 wide:left-auto wide:w-[420px] wide:shadow-float',
} as const;

/**
 * Modal dialog on Radix: focus is trapped, Esc closes, and focus returns to the trigger.
 * A full-screen sheet (or bottom sheet) on narrow screens, a centred panel up to 560px on wide ones.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  placement = 'center',
  className = '',
}: DialogProps) {
  // The dialog is controlled, so Radix does not know which element opened it. Remember the
  // focused element as the dialog opens and give focus back to it on close.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <RadixDialog.Content
          onOpenAutoFocus={() => {
            opener.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          // Without a description, say so explicitly so Radix does not warn.
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={`fixed z-50 flex flex-col overflow-y-auto bg-raised p-4 text-ink ${NARROW[placement]} ${WIDE[placement]} ${className}`}
        >
          <div className="flex items-start justify-between gap-4">
            <RadixDialog.Title className="text-xl font-semibold">{title}</RadixDialog.Title>
            <RadixDialog.Close className="tap btn" aria-label="Close">
              Close
            </RadixDialog.Close>
          </div>
          {description ? (
            <RadixDialog.Description className="mt-1 text-sm text-ink-muted">
              {description}
            </RadixDialog.Description>
          ) : null}
          <div className="mt-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
