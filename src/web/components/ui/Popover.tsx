import * as RadixPopover from '@radix-ui/react-popover';
import type { ComponentProps } from 'react';

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;
export const PopoverClose = RadixPopover.Close;

/** A raised, bordered panel. The only shadow in the app is on popovers and dialogs. */
export function PopoverContent({
  className = '',
  ...props
}: ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        sideOffset={6}
        collisionPadding={12}
        className={`z-50 max-w-[calc(100vw-1.5rem)] rounded-panel border border-rule bg-raised p-3 text-ink shadow-float ${className}`}
        {...props}
      />
    </RadixPopover.Portal>
  );
}
