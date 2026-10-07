import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { ToastProvider } from '../components/ui/Toast';
import { TooltipProvider } from '../components/ui/Tooltip';
import { listenForInvalidations } from '../lib/broadcast';
import { createQueryClient } from '../lib/queryClient';
import { applyTheme, setReadingSize, watchSystemTheme, type ReadingSize } from '../lib/theme';
import { useSettings } from '../features/settings/useSettings';
import { createRouter } from './routes';

/** Applies the saved reading size and refreshes the local cache once settings load. */
function Preferences() {
  const { data } = useSettings();
  const size: ReadingSize | undefined = data?.prefs.readingSize;
  useEffect(() => {
    if (size) setReadingSize(size);
  }, [size]);
  return null;
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(createRouter);

  useEffect(() => {
    applyTheme();
    const stopTheme = watchSystemTheme();
    const stopSync = listenForInvalidations(queryClient);
    return () => {
      stopTheme();
      stopSync();
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={500}>
        <ToastProvider>
          <Preferences />
          <RouterProvider router={router} />
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
