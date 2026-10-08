import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactElement } from 'react';

export const TooltipProvider = RadixTooltip.Provider;

/**
 * Wraps one focusable element with a tooltip that says what it does and, when it has one, its
 * shortcut. Pass the same `keys` as `aria-keyshortcuts` on the element.
 */
export function Tip({
  label,
  keys,
  side,
  children,
}: {
  label: string;
  keys?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactElement;
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-[70] rounded-md bg-ink px-2 py-1 text-sm text-paper"
        >
          {label}
          {keys ? <span className="ml-2 opacity-80">{keys}</span> : null}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
