import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { useIsPhone } from '../../lib/useViewport';

export const Menu = RadixMenu.Root;
export const MenuTrigger = RadixMenu.Trigger;

/**
 * A menu anchored to its trigger, or a bottom sheet over a scrim on a phone. Extra classes (a
 * minimum width) apply only to the anchored form.
 */
export function MenuContent({ className, ...props }: ComponentProps<typeof RadixMenu.Content>) {
  const sheet = useIsPhone();
  return (
    <>
      {sheet ? (
        <RadixMenu.Portal>
          <div
            data-sheet-scrim
            data-state="open"
            aria-hidden="true"
            className="scrim fixed inset-0 z-40"
          />
        </RadixMenu.Portal>
      ) : null}
      <RadixMenu.Portal>
        <RadixMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={12}
          data-presentation={sheet ? 'sheet' : 'popover'}
          className={
            sheet
              ? 'sheet-in w-full rounded-t-lg bg-raised p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-ink shadow-3'
              : cx(
                  'pop-in z-50 min-w-44 rounded-md border border-line bg-raised p-1 text-ink shadow-2',
                  className,
                )
          }
          {...props}
        />
      </RadixMenu.Portal>
    </>
  );
}

export function MenuItem({
  children,
  danger = false,
  ...props
}: ComponentProps<typeof RadixMenu.Item> & { children: ReactNode; danger?: boolean }) {
  return (
    <RadixMenu.Item
      className={cx(
        'menu-item flex cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 outline-none data-[highlighted]:bg-surface',
        danger && 'text-danger',
      )}
      {...props}
    >
      {children}
    </RadixMenu.Item>
  );
}

export const MenuSeparator = () => <RadixMenu.Separator className="my-1 h-px bg-line" />;
