import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { normalizeTag } from '@shared/tags';
import type { PickItem } from '@shared/types';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import type { ChipLink, NoteDraft } from './draft';
import {
  detectTrigger,
  matchCommands,
  type Command,
  type Trigger,
  type TriggerKind,
} from './triggers';

/** What a row in the picker does when chosen. */
export type PickerAction =
  | { type: 'tag'; name: string }
  | { type: 'person'; id: string; name: string }
  | { type: 'createPerson'; name: string }
  | { type: 'link'; link: ChipLink }
  | { type: 'command'; command: Command['id'] };

export interface PickerRow {
  key: string;
  label: string;
  /** Kind label shown beside combined results ("Note", "Person", "Farm entry"). */
  kind?: string | undefined;
  detail?: string | null | undefined;
  action: PickerAction;
}

/** A picker opened by typing a trigger, or by a button or command (start is -1, no text to remove). */
export interface OpenPicker {
  kind: TriggerKind | 'any';
  start: number;
  end: number;
  query: string;
  byButton: boolean;
}

const KIND_LABEL = { note: 'Note', person: 'Person', planting: 'Farm entry', tag: 'Tag' } as const;

export const toTrigger = (p: OpenPicker): Trigger | null =>
  p.start < 0 || p.kind === 'any'
    ? null
    : { kind: p.kind, start: p.start, end: p.end, query: p.query };

/**
 * Picker state for the capture editor: which picker is open, what it lists, and the highlighted
 * row. Pickers open only on typed characters; pasted text and IME composition never open one.
 */
export function usePicker(value: NoteDraft) {
  const [open, setOpen] = useState<OpenPicker | null>(null);
  const [active, setActive] = useState(0);
  const dismissed = useRef<{ kind: TriggerKind; start: number } | null>(null);

  const kind = open?.kind;
  const query = open?.query ?? '';
  const linkedIds = useMemo(() => value.links.map((l) => l.id), [value.links]);

  const fetchKind = kind === 'command' || kind === undefined ? null : kind;
  const { data: fetched } = useQuery({
    queryKey: queryKeys.pick(`${fetchKind ?? 'none'}:${linkedIds.join(',')}`, query),
    queryFn: async ({ signal }): Promise<PickItem[]> => {
      if (fetchKind === 'tag') return (await api.pick('tag', query, [], signal)).items;
      if (fetchKind === 'person') return (await api.pick('person', query, linkedIds, signal)).items;
      if (fetchKind === 'any') return (await api.pick('any', query, linkedIds, signal)).items;
      // `[[`: notes and farm entries, interleaved.
      const [notes, plantings] = await Promise.all([
        api.pick('note', query, linkedIds, signal),
        api.pick('planting', query, linkedIds, signal),
      ]);
      const merged: PickItem[] = [];
      for (
        let i = 0;
        merged.length < 8 && (i < notes.items.length || i < plantings.items.length);
        i++
      ) {
        const n = notes.items[i];
        const p = plantings.items[i];
        if (n) merged.push(n);
        if (p && merged.length < 8) merged.push(p);
      }
      return merged;
    },
    enabled: fetchKind !== null,
    placeholderData: keepPreviousData,
  });

  const rows = useMemo<PickerRow[]>(() => {
    if (!open) return [];
    if (open.kind === 'command') {
      return matchCommands(query).map((c) => ({
        key: c.id,
        label: c.label,
        action: { type: 'command', command: c.id },
      }));
    }
    const items = fetched ?? [];
    if (open.kind === 'tag') {
      const have = new Set(value.tags.map((t) => t.toLowerCase()));
      const rowsOut: PickerRow[] = items
        .filter((i) => !have.has(i.label.toLowerCase()))
        .map((i) => ({ key: i.id, label: `#${i.label}`, action: { type: 'tag', name: i.label } }));
      const normalized = normalizeTag(query);
      const exact = items.some(
        (i) => normalized.ok && i.label.toLowerCase() === normalized.name.toLowerCase(),
      );
      if (
        query.trim() !== '' &&
        normalized.ok &&
        !exact &&
        !have.has(normalized.name.toLowerCase())
      ) {
        rowsOut.push({
          key: 'create-tag',
          label: `Create #${normalized.name}`,
          action: { type: 'tag', name: normalized.name },
        });
      }
      return rowsOut;
    }
    const rowsOut: PickerRow[] = items.map((i) => ({
      key: `${i.kind}:${i.id}`,
      label: i.label,
      kind: open.kind === 'person' ? undefined : KIND_LABEL[i.kind],
      detail: i.detail,
      action:
        i.kind === 'person' && open.kind === 'person'
          ? { type: 'person', id: i.id, name: i.label }
          : i.kind === 'person'
            ? { type: 'link', link: { type: 'person', id: i.id, label: i.label } }
            : {
                type: 'link',
                link: { type: i.kind as 'note' | 'planting', id: i.id, label: i.label },
              },
    }));
    if (open.kind === 'person' && query.trim() !== '') {
      rowsOut.push({
        key: 'create-person',
        label: `Create person ‘${query.trim()}’`,
        action: { type: 'createPerson', name: query.trim() },
      });
    }
    return rowsOut;
  }, [open, fetched, query, value.tags]);

  const close = useCallback(() => {
    setOpen(null);
    setActive(0);
  }, []);

  /** Esc: close and remember it, so the same trigger does not pop straight back open. */
  const dismiss = useCallback(() => {
    if (open && open.start >= 0 && open.kind !== 'any')
      dismissed.current = { kind: open.kind, start: open.start };
    close();
  }, [open, close]);

  /** The text changed. Open, update or close the picker; `typed` is false for paste and IME. */
  const onText = useCallback(
    (text: string, caret: number, typed: boolean) => {
      const trigger = detectTrigger(text, caret);
      if (!trigger) {
        dismissed.current = null;
        if (open && !open.byButton) close();
        return;
      }
      if (dismissed.current?.kind === trigger.kind && dismissed.current.start === trigger.start)
        return;
      if (!typed && !open) return;
      if (!typed && open && open.start !== trigger.start) {
        close();
        return;
      }
      setOpen({ ...trigger, byButton: false });
      setActive(0);
    },
    [open, close],
  );

  const openByButton = useCallback((pickerKind: OpenPicker['kind'], caret: number) => {
    setOpen({ kind: pickerKind, start: -1, end: caret, query: '', byButton: true });
    setActive(0);
  }, []);

  const setButtonQuery = useCallback((q: string) => {
    setOpen((p) => (p ? { ...p, query: q } : p));
  }, []);

  /** Keys while a picker is open. Returns true when the key was handled. */
  const onKey = (event: KeyboardEvent, select: (row: PickerRow) => void): boolean => {
    if (!open || event.nativeEvent.isComposing) return false;
    const last = Math.max(rows.length - 1, 0);
    if (event.key === 'ArrowDown') setActive((i) => (i >= last ? 0 : i + 1));
    else if (event.key === 'ArrowUp') setActive((i) => (i <= 0 ? last : i - 1));
    else if (event.key === 'Escape') dismiss();
    else if ((event.key === 'Enter' && !event.metaKey && !event.ctrlKey) || event.key === 'Tab') {
      const row = rows[Math.min(active, last)];
      if (row) select(row);
      else close();
    } else return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  return {
    open,
    rows,
    active,
    setActive,
    close,
    dismiss,
    onText,
    onKey,
    openByButton,
    setButtonQuery,
  };
}
