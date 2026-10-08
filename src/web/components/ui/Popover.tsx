import * as RadixPopover from '@radix-ui/react-popover';
import type { ComponentProps } from 'react';
import { cx } from '../../lib/cx';
import { useIsPhone } from '../../lib/useViewport';

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;
export const PopoverClose = RadixPopover.Close;

/**
 * A raised panel next to its trigger, or a bottom sheet over a scrim on a phone, where a small
 * anchored panel is hard to hit. Extra classes (a width) apply only to the anchored form.
 */
export function PopoverContent({
  className,
  ...props
}: ComponentProps<typeof RadixPopover.Content>) {
  const sheet = useIsPhone();
  return (
    <>
      {sheet ? (
        <RadixPopover.Portal>
          <div
            data-sheet-scrim
            data-state="open"
            aria-hidden="true"
            className="scrim fixed inset-0 z-40"
          />
        </RadixPopover.Portal>
      ) : null}
      <RadixPopover.Portal>
        <RadixPopover.Content
          sideOffset={6}
          collisionPadding={12}
          data-presentation={sheet ? 'sheet' : 'popover'}
          className={
            sheet
              ? 'sheet-in max-h-[80dvh] w-full overflow-y-auto rounded-t-lg bg-raised p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-ink shadow-3'
              : cx(
                  'pop-in z-50 max-w-[calc(100vw-1.5rem)] rounded-md border border-line bg-raised p-3 text-ink shadow-2',
                  className,
                )
          }
          {...props}
        />
      </RadixPopover.Portal>
    </>
  );
}
