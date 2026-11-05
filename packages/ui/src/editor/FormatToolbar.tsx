import { useRef, useState } from 'react';
import { useApp } from '../app/context';
import { commands } from '../commands/manifest';
import { detectPlatform, formatShortcut } from '../shortcuts/keys';

const BUTTONS = [
  ['format.bold', 'B'],
  ['format.italic', 'I'],
  ['format.link', 'Link'],
  ['format.bullet', '•'],
  ['format.heading', 'H'],
  ['format.task', '☑'],
] as const;

/** Formatting toolbar (AS-4): the same commands and shortcuts as the keyboard, through `registry.run`. One tab stop, arrows rove. */
export function FormatToolbar({ disabled, hidden }: { disabled: boolean; hidden: boolean }) {
  const { registry, model } = useApp();
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const platform = detectPlatform();
  const focusAt = (i: number) => {
    const n = BUTTONS.length;
    const j = (i + n) % n;
    setActive(j);
    box.current?.querySelectorAll('button')[j]?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') focusAt(active + 1);
    else if (e.key === 'ArrowLeft') focusAt(active - 1);
    else if (e.key === 'Home') focusAt(0);
    else if (e.key === 'End') focusAt(BUTTONS.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div
      ref={box}
      className="banner format-toolbar"
      role="toolbar"
      aria-label="Formatting"
      hidden={hidden}
      onKeyDown={onKeyDown}
    >
      {BUTTONS.map(([id, glyph], i) => {
        const spec = commands.find((c) => c.id === id)!;
        const keys = spec.shortcut ? ` (${formatShortcut(spec.shortcut, platform)})` : '';
        return (
          <button
            key={id}
            type="button"
            aria-label={spec.title}
            title={`${spec.title}${keys}`}
            tabIndex={i === active ? 0 : -1}
            disabled={disabled}
            onFocus={() => setActive(i)}
            onClick={() => {
              setActive(i); // the tab stop follows the mouse too
              registry.run(id);
              model.hooks.focusEditor?.(); // back to the text so the user keeps typing
            }}
          >
            {glyph}
          </button>
        );
      })}
    </div>
  );
}
