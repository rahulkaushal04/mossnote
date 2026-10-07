import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, ReactNode } from 'react';

export const Menu = RadixMenu.Root;
export const MenuTrigger = RadixMenu.Trigger;

export function MenuContent({
  className = '',
  ...props
}: ComponentProps<typeof RadixMenu.Content>) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        align="end"
        sideOffset={4}
        collisionPadding={12}
        className={`z-50 min-w-44 rounded-panel border border-rule bg-raised p-1 text-ink shadow-float ${className}`}
        {...props}
      />
    </RadixMenu.Portal>
  );
}

export function MenuItem({
  children,
  danger = false,
  ...props
}: ComponentProps<typeof RadixMenu.Item> & { children: ReactNode; danger?: boolean }) {
  return (
    <RadixMenu.Item
      className={`tap flex cursor-pointer items-center gap-2 rounded-control px-3 py-1.5 outline-none data-[highlighted]:bg-surface ${danger ? 'text-danger' : ''}`}
      {...props}
    >
      {children}
    </RadixMenu.Item>
  );
}

export const MenuSeparator = () => <RadixMenu.Separator className="my-1 h-px bg-rule" />;
