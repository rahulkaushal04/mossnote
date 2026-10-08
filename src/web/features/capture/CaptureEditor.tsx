import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { ulid } from 'ulid';
import { SparkIcon } from '../../components/ui/icons';
import { api } from '../../lib/api';
import { caretPosition } from '../../lib/caret';
import { GameDateChip } from '../calendar/GameDateChip';
import { LinkChip, TagList } from '../notes/NoteParts';
import { effectiveDate, isDraftEmpty, withLink, withTag, type NoteDraft } from './draft';
import { optionId, PickerList } from './PickerList';
import { applyTrigger } from './triggers';
import { toTrigger, usePicker, type PickerRow } from './usePicker';

export interface CaptureEditorProps {
  value: NoteDraft;
  onChange: (next: NoteDraft) => void;
  /** The date used when the draft has no explicit one. */
  defaultGameDate: number | null;
  mode: 'compose' | 'edit';
  /** `mod+Enter`: save (composer) or finish editing (inline editor). */
  onSubmit?: () => void;
  /** Esc with no picker open. Without it, Esc just blurs and the draft stays. */
  onEscape?: () => void;
  focusOnMount?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /** Run once on mount: show the title field, or open the link picker. */
  initialAction?: 'title' | 'link' | undefined;
  /** Right-hand end of the action row, for example the Save button. */
  actions?: ReactNode;
  describedBy?: string | undefined;
}

const TEXT_BUTTON = 'tap rounded-md px-2 text-sm text-ink-muted hover:bg-surface hover:text-ink';
const TOGGLE =
  'tap inline-flex items-center justify-center rounded-md px-2 text-sm hover:bg-surface aria-pressed:bg-surface aria-pressed:font-semibold';

/**
 * The shared text area, chips, flags and trigger handling used by the composer and by inline
 * editing. The text area is an ARIA combobox: `#`, `@`, `[[` and `/` open a
 * caret-anchored picker as the user types.
 */
export function CaptureEditor({
  value,
  onChange,
  defaultGameDate,
  mode,
  onSubmit,
  onEscape,
  focusOnMount = false,
  textareaRef,
  initialAction,
  actions,
  describedBy,
}: CaptureEditorProps) {
  const ownRef = useRef<HTMLTextAreaElement | null>(null);
  const area = textareaRef ?? ownRef;
  const titleRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const picker = usePicker(value);
  const [focused, setFocused] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const [busy, setBusy] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // The action row shows while anything inside has focus. Tracked with native focus events.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onIn = () => {
      setFocused(true);
    };
    const onOut = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node && el.contains(event.relatedTarget)))
        setFocused(false);
    };
    el.addEventListener('focusin', onIn);
    el.addEventListener('focusout', onOut);
    return () => {
      el.removeEventListener('focusin', onIn);
      el.removeEventListener('focusout', onOut);
    };
  }, []);

  // Grow with the content, from 3 rows up to 40% of the viewport, then scroll.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [value.body, area]);

  useEffect(() => {
    if (focusOnMount) area.current?.focus();
  }, [focusOnMount, area]);

  /** Anchor the picker to the caret. Measured in event handlers, where reading the DOM is fine. */
  const placeAnchor = (offset: number) => {
    const el = area.current;
    if (!el) return;
    const position = caretPosition(el, offset);
    setAnchor({
      top: el.offsetTop + position.top + position.height + 4,
      left: Math.max(0, Math.min(el.offsetLeft + position.left, el.clientWidth - 288)),
    });
  };

  const openByButton = (kind: 'tag' | 'person' | 'any', caret: number) => {
    placeAnchor(caret);
    picker.openByButton(kind, caret);
  };

  useEffect(() => {
    if (picker.open?.byButton) searchRef.current?.focus();
  }, [picker.open?.byButton, picker.open?.kind]);

  const ranInitial = useRef(false);
  useEffect(() => {
    if (ranInitial.current || !initialAction) return;
    ranInitial.current = true;
    // Deferred a frame so the editor has mounted before it changes its own state.
    requestAnimationFrame(() => {
      if (initialAction === 'title') {
        onChange({ ...value, title: value.title ?? '' });
        requestAnimationFrame(() => titleRef.current?.focus());
      } else {
        openByButton('any', value.body.length);
      }
    });
  });

  const restoreCaret = (offset: number) => {
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(offset, offset);
    });
  };

  const select = async (row: PickerRow) => {
    const open = picker.open;
    if (!open || busy) return;
    const trigger = toTrigger(open);
    const el = area.current;
    let next = value;
    let caret = el?.selectionStart ?? value.body.length;

    const replace = (replacement: string) => {
      if (trigger) {
        const applied = applyTrigger(next.body, trigger, replacement);
        next = { ...next, body: applied.text };
        caret = applied.caret;
      } else if (replacement) {
        next = { ...next, body: next.body.slice(0, caret) + replacement + next.body.slice(caret) };
        caret += replacement.length;
      }
    };

    const action = row.action;
    if (action.type === 'tag') {
      replace('');
      next = withTag(next, action.name);
    } else if (action.type === 'person' || action.type === 'createPerson') {
      let person = action.type === 'person' ? { id: action.id, name: action.name } : null;
      if (action.type === 'createPerson') {
        setBusy(true);
        try {
          const created = await api.createPerson({ id: ulid(), name: action.name });
          person = { id: created.id, name: created.name };
        } catch {
          setBusy(false);
          return;
        }
        setBusy(false);
      }
      if (person) {
        replace(person.name);
        next = withLink(next, { type: 'person', id: person.id, label: person.name });
      }
    } else if (action.type === 'link') {
      replace('');
      next = withLink(next, action.link);
    } else {
      replace('');
      picker.close();
      onChange(next);
      restoreCaret(caret);
      runCommand(action.command, next, caret);
      return;
    }
    picker.close();
    onChange(next);
    restoreCaret(caret);
  };

  const runCommand = (id: string, current: NoteDraft, caret: number) => {
    if (id === 'title') {
      onChange({ ...current, title: current.title ?? '' });
      requestAnimationFrame(() => titleRef.current?.focus());
    } else if (id === 'date') setDateOpen(true);
    else if (id === 'discovery') onChange({ ...current, isDiscovery: !current.isDiscovery });
    else if (id === 'question') onChange({ ...current, isQuestion: !current.isQuestion });
    else if (id === 'tag') openByButton('tag', caret);
    else if (id === 'person') openByButton('person', caret);
    else if (id === 'link') openByButton('any', caret);
  };

  const onText = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent as InputEvent;
    const typed = native.inputType === 'insertText' && !native.isComposing;
    onChange({ ...value, body: event.target.value });
    if (native.isComposing) return;
    picker.onText(event.target.value, event.target.selectionStart, typed);
    placeAnchor(event.target.selectionStart);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (picker.open && !picker.open.byButton && picker.onKey(event, (row) => void select(row)))
      return;
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      onSubmit?.();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (onEscape) onEscape();
      else area.current?.blur();
    }
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (picker.onKey(event, (row) => void select(row))) {
      if (event.key === 'Escape') area.current?.focus();
    }
  };

  const open = picker.open;
  const inline = open !== null && !open.byButton;
  const showActions =
    mode === 'edit' || focused || dateOpen || open !== null || !isDraftEmpty(value);
  const date = effectiveDate(value, defaultGameDate);
  const emptyText =
    open?.kind === 'person'
      ? 'No one matches.'
      : open?.kind === 'tag'
        ? 'No tags yet.'
        : 'No matches.';

  return (
    <div
      ref={wrapperRef}
      role="group"
      aria-label={mode === 'compose' ? 'Write a note' : 'Edit note'}
      className="relative flex flex-col gap-2"
    >
      {value.title !== null ? (
        <input
          ref={titleRef}
          aria-label="Title"
          placeholder="Title"
          value={value.title}
          onChange={(e) => {
            onChange({ ...value, title: e.target.value });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              area.current?.focus();
            }
          }}
          className="reading w-full border-0 border-b border-line bg-transparent pb-1 font-semibold outline-offset-4 placeholder:text-ink-muted"
        />
      ) : null}

      <textarea
        ref={area}
        rows={3}
        value={value.body}
        placeholder="Write something down…"
        aria-label="Note"
        aria-describedby={describedBy}
        role="combobox"
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-expanded={inline}
        aria-controls={listId}
        aria-activedescendant={
          inline && picker.rows.length > 0 ? optionId(listId, picker.active) : undefined
        }
        onChange={onText}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          picker.close();
        }}
        className="reading max-h-[40vh] w-full resize-none border-0 bg-transparent p-0 outline-offset-4 placeholder:text-ink-muted"
      />

      {value.tags.length > 0 || value.links.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <TagList
            tags={value.tags}
            onRemove={(tag) => {
              onChange({ ...value, tags: value.tags.filter((t) => t !== tag) });
            }}
          />
          {value.links.map((link) => (
            <LinkChip
              key={`${link.type}:${link.id}`}
              link={link}
              onRemove={() => {
                onChange({
                  ...value,
                  links: value.links.filter((l) => !(l.type === link.type && l.id === link.id)),
                });
              }}
            />
          ))}
        </div>
      ) : null}

      {open ? (
        <PickerList
          id={listId}
          rows={picker.rows}
          active={picker.active}
          onHover={picker.setActive}
          onSelect={(row) => void select(row)}
          emptyText={emptyText}
          top={anchor.top}
          left={anchor.left}
          searchInputRef={searchRef}
          {...(open.byButton
            ? {
                search: {
                  value: open.query,
                  onChange: picker.setButtonQuery,
                  onKeyDown: onSearchKey,
                  activeId: picker.rows.length > 0 ? optionId(listId, picker.active) : undefined,
                  listId,
                },
              }
            : {})}
        />
      ) : null}

      {showActions ? (
        <div
          className="flex flex-wrap items-center gap-1 text-ink-muted"
          role="group"
          aria-label="Note options"
        >
          <GameDateChip
            value={date}
            onChange={(key) => {
              onChange({ ...value, gameDate: key });
            }}
            emptyLabel="Add date"
            clearLabel="Clear date"
            title="Date of this note"
            open={dateOpen}
            onOpenChange={setDateOpen}
          />
          <button
            type="button"
            className={`${TOGGLE} ${value.isDiscovery ? 'text-discovery' : ''}`}
            aria-pressed={value.isDiscovery}
            aria-label="Discovery"
            onClick={() => {
              onChange({ ...value, isDiscovery: !value.isDiscovery });
            }}
          >
            <SparkIcon />
          </button>
          <button
            type="button"
            className={`${TOGGLE} ${value.isQuestion ? 'text-question' : ''}`}
            aria-pressed={value.isQuestion}
            aria-label="Question"
            onClick={() => {
              onChange({ ...value, isQuestion: !value.isQuestion });
            }}
          >
            ?
          </button>
          {value.title === null ? (
            <button
              type="button"
              className={TEXT_BUTTON}
              onClick={() => {
                onChange({ ...value, title: '' });
                requestAnimationFrame(() => titleRef.current?.focus());
              }}
            >
              Title
            </button>
          ) : null}
          <button
            type="button"
            className={TEXT_BUTTON}
            onClick={() => {
              openByButton('tag', area.current?.selectionStart ?? 0);
            }}
          >
            Tag
          </button>
          <button
            type="button"
            className={TEXT_BUTTON}
            onClick={() => {
              openByButton('any', area.current?.selectionStart ?? 0);
            }}
          >
            Link
          </button>
          <span className="ml-auto flex items-center gap-2">{actions}</span>
        </div>
      ) : null}
    </div>
  );
}
