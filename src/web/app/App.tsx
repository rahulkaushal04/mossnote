import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { templateById } from '@shared/templates';
import { ToastProvider } from '../components/ui/Toast';
import { TooltipProvider } from '../components/ui/Tooltip';
import { listenForInvalidations } from '../lib/broadcast';
import { IS_STANDALONE } from '../lib/mode';
import { createQueryClient } from '../lib/queryClient';
import { UpdateBanner } from '../standalone/UpdateBanner';
import {
  applyTheme,
  applyTint,
  setReadingSize,
  watchSystemTheme,
  type ReadingSize,
} from '../lib/theme';
import { useSettings } from '../features/settings/useSettings';
import { createRouter } from './routes';

/**
 * Applies the saved reading size and the journal's tint, and refreshes their local caches once
 * settings load. The tint comes from the journal's template, so it is the same on every device.
 */
function Preferences() {
  const { data } = useSettings();
  const size: ReadingSize | undefined = data?.prefs.readingSize;
  const template = data?.layout.template;
  useEffect(() => {
    if (size) setReadingSize(size);
  }, [size]);
  useEffect(() => {
    if (template !== undefined) applyTint(templateById(template).tint);
  }, [template]);
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
          {IS_STANDALONE ? <UpdateBanner /> : null}
          <RouterProvider router={router} />
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
