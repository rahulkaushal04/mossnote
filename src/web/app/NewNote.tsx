import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Dialog } from '../components/ui/Dialog';
import type { ChipLink } from '../features/capture/draft';
import { Composer } from '../features/capture/Composer';
import { useCalendar } from '../features/calendar/CalendarProvider';

interface NewNoteApi {
  /** `n`: focus the page's composer if it has one, otherwise open the quick composer dialog. */
  requestNewNote: (preset?: { links?: ChipLink[] }) => void;
  /** Pages with an inline composer register its text area here. */
  registerInline: (ref: RefObject<HTMLTextAreaElement | null> | null) => void;
}

const NewNoteContext = createContext<NewNoteApi | null>(null);

export const useNewNote = (): NewNoteApi => {
  const value = useContext(NewNoteContext);
  if (!value) throw new Error('useNewNote must be used inside <NewNoteProvider>.');
  return value;
};

/** Owns the quick-capture dialog (draft scope `quick`) and the `n` behaviour (spec section 5.1). */
export function NewNoteProvider({ children }: { children: ReactNode }) {
  const calendar = useCalendar();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<ChipLink[]>([]);
  const inline = useRef<RefObject<HTMLTextAreaElement | null> | null>(null);

  const requestNewNote = useCallback((options?: { links?: ChipLink[] }) => {
    const links = options?.links ?? [];
    const el = inline.current?.current;
    // A preset ("Write about …") always opens the dialog, so the chip is there to see.
    if (el?.isConnected && links.length === 0) {
      el.focus();
      return;
    }
    setPreset(links);
    setOpen(true);
  }, []);
  const registerInline = useCallback((ref: RefObject<HTMLTextAreaElement | null> | null) => {
    inline.current = ref;
  }, []);
  const api = useMemo(() => ({ requestNewNote, registerInline }), [requestNewNote, registerInline]);

  return (
    <NewNoteContext.Provider value={api}>
      {children}
      <Dialog open={open} onOpenChange={setOpen} title="New note">
        <Composer
          scope="quick"
          defaultGameDate={calendar.currentGameDate}
          focusOnMount
          presetLinks={preset}
          onSaved={() => {
            setOpen(false);
          }}
        />
      </Dialog>
    </NewNoteContext.Provider>
  );
}
