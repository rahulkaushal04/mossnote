import { useMemo, useState } from 'react';
import type { CommandSpec } from '../commands/manifest';
import { fuzzyScore } from '../commands/fuzzy';
import { detectPlatform, formatShortcut, matchesEvent, type Platform } from '../shortcuts/keys';
import { useModal } from '../dialog/useModal';
import './palette.css';

export interface PaletteProps {
  /** Enabled commands only (`registry.list()`). */
  commands: readonly CommandSpec[];
  /** undefined while loading; the palette shows a loading row and still lists commands. */
  notes: readonly { id: string; title: string }[] | undefined;
  /** Set when the notes could not be loaded; shows a message and a Retry button. */
  notesError?: string;
  onRetryNotes?(): void;
  onRunCommand(id: string): void;
  onOpenNote(id: string): void;
  onCreateNote(title: string): void;
  onClose(): void;
  platform?: Platform;
  /** Rows rendered at most; default 50. */
  limit?: number;
}

type Row =
  | { kind: 'command'; key: string; label: string; spec: CommandSpec }
  | { kind: 'note'; key: string; label: string }
  | { kind: 'create'; key: string; label: string };

export function Palette(p: PaletteProps) {
  const { commands, notes, limit = 50, platform = detectPlatform() } = p;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const { ref: dialog, onKeyDown: onModalKey } = useModal(p.onClose);
  const q = query.trim();

  const rows = useMemo<Row[]>(() => {
    const scored: { row: Row; score: number }[] = [];
    for (const c of commands) {
      const s = q ? fuzzyScore(q, c.title) : 0;
      if (s !== null)
        scored.push({
          score: s + 0.5,
          row: { kind: 'command', key: c.id, label: c.title, spec: c },
        });
    }
    // Empty query: notes are not scored or sorted at all (10k notes stay free); only the first rows are taken.
    const noteRows: typeof scored = [];
    for (const n of notes ?? []) {
      if (!q && noteRows.length >= limit) break;
      const label = n.title || 'Untitled';
      const s = q ? fuzzyScore(q, label) : 0;
      if (s !== null) noteRows.push({ score: s, row: { kind: 'note', key: n.id, label } });
    }
    scored.push(...noteRows);
    if (q) scored.sort((a, b) => b.score - a.score);
    const out = scored.slice(0, limit).map((x) => x.row);
    if (q) out.push({ kind: 'create', key: 'create', label: `Create note “${q}”` });
    return out;
  }, [commands, notes, q, limit]);

  const idx = Math.min(active, rows.length - 1);
  const optId = (i: number) => `mn-pal-opt-${i}`;
  const choose = (r: Row | undefined) => {
    if (!r) return;
    p.onClose();
    if (r.kind === 'command') p.onRunCommand(r.key);
    else if (r.kind === 'note') p.onOpenNote(r.key);
    else p.onCreateNote(q);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const nav: Record<string, number> = {
      ArrowDown: Math.min(idx + 1, rows.length - 1),
      ArrowUp: Math.max(idx - 1, 0),
      Home: 0,
      End: rows.length - 1,
    };
    if (e.key in nav) {
      e.preventDefault();
      setActive(nav[e.key]!);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(rows[idx]);
    } else if (matchesEvent(e.nativeEvent, 'Mod-k', platform)) {
      e.preventDefault();
      e.stopPropagation();
      p.onClose();
    } else onModalKey(e);
  };
  const realRows = rows.filter((r) => r.kind !== 'create').length;

  return (
    <div className="mn-palette-backdrop">
      <div
        ref={dialog}
        className="mn-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
      >
        <input
          type="text"
          role="combobox"
          aria-label="Search commands and notes"
          aria-expanded={rows.length > 0}
          aria-controls={rows.length ? 'mn-pal-list' : undefined}
          aria-activedescendant={rows.length ? optId(idx) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
        {rows.length > 0 && (
          <ul id="mn-pal-list" role="listbox" aria-label="Results">
            {rows.map((r, i) => (
              <li
                key={`${r.kind}:${r.key}`}
                id={optId(i)}
                role="option"
                aria-selected={i === idx}
                className={i === idx ? 'mn-pal-active' : undefined}
                onMouseMove={() => i !== idx && setActive(i)}
                onClick={() => choose(r)}
              >
                <span>{r.label}</span>
                {r.kind === 'command' && r.spec.shortcut && (
                  <kbd>{formatShortcut(r.spec.shortcut, platform)}</kbd>
                )}
                {r.kind === 'note' && <span className="mn-pal-kind">Note</span>}
              </li>
            ))}
          </ul>
        )}
        <div role="status" className="mn-pal-status">
          {notes === undefined && !p.notesError && 'Loading notes…'}
          {p.notesError && <span>Couldn’t load notes: {p.notesError} </span>}
          {p.notesError && p.onRetryNotes && <button onClick={p.onRetryNotes}>Retry</button>}
          {q && realRows === 0 && notes !== undefined && 'No matches'}
        </div>
      </div>
    </div>
  );
}
