/**
 * A keyboard-operable context menu positioned at the pointer.
 */
import { useEffect, useRef } from 'react';
import { modLabel } from '../../lib/hotkeys';

export interface MenuEntry {
  label: string;
  keys?: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => void;
}

export type MenuItems = (MenuEntry | 'sep')[];

/**
 * A right-click menu. Arrow keys move, Enter chooses, Escape or a click elsewhere closes it, and
 * it keeps itself on screen. Radix has no menu for a free pointer position, so this is small and
 * plain.
 */
export function ContextMenu({
  at,
  items,
  onClose,
}: {
  at: { x: number; y: number };
  items: MenuItems;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8))}px`;
    el.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const close = (e: Event) => {
      if (!el.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('blur', onClose);
    };
  }, [at, onClose]);

  const move = (dir: 1 | -1) => {
    const buttons = [
      ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []),
    ];
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    buttons[(i + dir + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label="Map actions"
      className="fixed z-50 min-w-52 rounded-lg border border-line bg-raised p-1 text-ink shadow-2"
      style={{ left: at.x, top: at.y }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {items.map((item, i) =>
        item === 'sep' ? (
          <div key={i} role="separator" className="my-1 h-px bg-line" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={`tap flex w-full items-center justify-between gap-6 rounded-md px-3 py-1.5 text-left outline-none focus:bg-surface enabled:hover:bg-surface disabled:opacity-45 ${item.danger ? 'text-danger' : ''}`}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span>{item.label}</span>
            {item.keys ? (
              <span className="text-xs text-ink-muted">{item.keys.replace('Mod', modLabel())}</span>
            ) : null}
          </button>
        ),
      )}
    </div>
  );
}
