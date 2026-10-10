import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Dialog } from '../components/ui/Dialog';
import { useCalendar } from '../features/calendar/CalendarProvider';
import { DatePickerBody } from '../features/calendar/GameDatePicker';
import { useSetCurrentDate } from '../features/calendar/useCurrentDate';

const SetDateContext = createContext<(() => void) | null>(null);

/** Open the "Set the in-game date" dialog from anywhere (`d s`, the palette). */
export const useOpenSetDate = (): (() => void) => {
  const value = useContext(SetDateContext);
  if (!value) throw new Error('useOpenSetDate must be used inside <SetDateProvider>.');
  return value;
};

export function SetDateProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const calendar = useCalendar();
  const setDate = useSetCurrentDate();
  const show = useCallback(() => {
    setOpen(true);
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <SetDateContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={setOpen} title="Set the in-game date" placement="bottom">
        {open ? (
          <DatePickerBody
            value={calendar.currentGameDate}
            clearLabel="Stop dating new notes"
            onChange={(key) => {
              setDate.mutate(key);
            }}
            close={() => {
              setOpen(false);
            }}
          />
        ) : null}
      </Dialog>
    </SetDateContext.Provider>
  );
}
