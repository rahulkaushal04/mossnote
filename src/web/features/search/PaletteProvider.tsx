import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CommandPalette } from './CommandPalette';

interface PaletteApi {
  open: boolean;
  openPalette: () => void;
  setOpen: (open: boolean) => void;
}

const PaletteContext = createContext<PaletteApi | null>(null);

export const usePalette = (): PaletteApi => {
  const value = useContext(PaletteContext);
  if (!value) throw new Error('usePalette must be used inside <PaletteProvider>.');
  return value;
};

/** Owns the search palette: `mod+K` anywhere, `/` outside text fields, and the header button. */
export function PaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openPalette = useCallback(() => {
    setOpen(true);
  }, []);
  const api = useMemo(() => ({ open, openPalette, setOpen }), [open, openPalette]);
  return (
    <PaletteContext.Provider value={api}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </PaletteContext.Provider>
  );
}
