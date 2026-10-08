import * as RadixDialog from '@radix-ui/react-dialog';
import { useRef, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { useIsPhone } from '../../lib/useViewport';
import { CloseIcon } from './icons';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required: the dialog is labelled by its title. */
  title: string;
  description?: string;
  children: ReactNode;
  /**
   * `center` and `bottom` are a centred panel, `right` a side drawer. On a phone (under 640px)
   * all of them become a bottom sheet. `sheet` is a bottom sheet at every width, for content
   * that is only ever opened from a phone-style control (the More tab, a filter list).
   */
  placement?: 'center' | 'bottom' | 'right' | 'sheet';
  /** Extra classes for the panel, such as a wider width. Ignored when it is shown as a sheet. */
  className?: string;
}

const SHEET =
  'sheet-in fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] w-full max-w-xl flex-col overflow-y-auto rounded-t-lg bg-raised px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-ink shadow-3';

const PANEL = {
  center:
    'pop-in fixed top-1/2 left-1/2 z-50 flex max-h-[80dvh] w-[560px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg bg-raised p-5 text-ink shadow-3',
  drawer:
    'slide-in-right fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-full flex-col overflow-y-auto bg-raised p-5 text-ink shadow-3',
} as const;

/**
 * Modal dialog on Radix: focus is trapped, Esc closes, and focus returns to the trigger.
 * A bottom sheet on a phone, a centred panel (or side drawer) from 640px up.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  placement = 'center',
  className,
}: DialogProps) {
  const phone = useIsPhone();
  const sheet = phone || placement === 'sheet';
  const presentation = sheet ? 'sheet' : placement === 'right' ? 'drawer' : 'panel';
  // The dialog is controlled, so Radix does not know which element opened it. Remember the
  // focused element as the dialog opens and give focus back to it on close.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="scrim fixed inset-0 z-40" />
        <RadixDialog.Content
          data-presentation={presentation}
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
          className={
            sheet ? SHEET : cx(presentation === 'drawer' ? PANEL.drawer : PANEL.center, className)
          }
        >
          {sheet ? (
            <div
              data-sheet-handle
              aria-hidden="true"
              className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-control"
            />
          ) : null}
          <div className="flex items-start justify-between gap-4">
            <RadixDialog.Title className="font-serif text-lg font-semibold">
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close className="btn btn-icon btn-ghost -mt-1 -mr-2" aria-label="Close">
              <CloseIcon className="size-5" />
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
