import { useEffect } from 'react';
import { commands as manifest, type CommandSpec } from './manifest';
import { detectPlatform, matchesEvent, type Platform } from '../shortcuts/keys';

export interface Registry {
  /** Attach a handler. Returns an unbind function. Unknown ids throw (a typo must not be silent). */
  bind(id: string, run: () => void, opts?: { enabled?: () => boolean }): () => void;
  /** Runs the command if bound and enabled; returns whether it ran. */
  run(id: string): boolean;
  /** Enabled commands only, in manifest order. */
  list(): CommandSpec[];
  has(id: string): boolean;
}

export function createRegistry(specs: readonly CommandSpec[] = manifest): Registry {
  const known = new Set(specs.map((s) => s.id));
  const bound = new Map<string, { run: () => void; enabled: () => boolean }>();
  const ok = (id: string) => bound.get(id)?.enabled() === true;
  return {
    bind(id, run, opts) {
      if (!known.has(id)) throw new Error(`unknown command: ${id}`);
      const entry = { run, enabled: opts?.enabled ?? (() => true) };
      bound.set(id, entry);
      return () => {
        if (bound.get(id) === entry) bound.delete(id);
      };
    },
    run(id) {
      if (!ok(id)) return false;
      bound.get(id)!.run();
      return true;
    },
    list: () => specs.filter((s) => ok(s.id)),
    has: (id) => bound.has(id),
  };
}

/** Palette toggle; handled in the capture phase so it also works inside CodeMirror. */
const PALETTE = 'view.palette';

/**
 * Window keydown handling. Editor focus: only Mod-K and commands the editor keymap does not own
 * (not `format.*`, which formattingKeymap handles). Elsewhere: every manifest shortcut. An open
 * alertdialog blocks everything; any other modal (aria-modal) blocks everything except Mod-K.
 * Desktop menu `command` events must call the same `registry.run(id)`.
 */
export function useGlobalShortcuts(
  registry: Registry,
  opts: { platform?: Platform; specs?: readonly CommandSpec[] } = {},
): void {
  const { platform = detectPlatform(), specs = manifest } = opts;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (document.querySelector('[role=alertdialog]')) return;
      const inEditor = e.target instanceof Element && !!e.target.closest('.cm-editor');
      const modal = !!document.querySelector('[aria-modal=true]');
      for (const s of specs) {
        if (!s.shortcut || !matchesEvent(e, s.shortcut, platform)) continue;
        if (s.id !== PALETTE && (modal || (inEditor && s.id.startsWith('format.')))) continue;
        if (registry.run(s.id)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [registry, platform, specs]);
}
