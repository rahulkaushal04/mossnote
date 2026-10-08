import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, useParams, type RouteObject } from 'react-router';
import { CalendarProvider } from '../features/calendar/CalendarProvider';
import { PaletteProvider } from '../features/search/PaletteProvider';
import { BASE_PATH } from '../lib/mode';
import { NewNoteProvider } from './NewNote';
import { SetDateProvider } from './SetDate';
import { DayPage } from '../features/today/DayPage';
import { TodayPage } from '../features/today/TodayPage';
import { FarmPage } from '../features/farm/FarmPage';
import { PlantingSheet } from '../features/farm/PlantingSheet';
import { JournalPage } from '../features/journal/JournalPage';
import { MapsPage } from '../features/maps/MapsPage';
import { useUsesSection } from '../features/settings/useLayout';
import { NotePage } from '../features/notes/NotePage';
import { PeoplePage } from '../features/people/PeoplePage';
import { PersonPage } from '../features/people/PersonPage';
import { NotFoundPage } from './NotFoundPage';
import { RouteError } from './RouteError';
import { ServerGate } from './ServerGate';
import { Shell } from './Shell';

// Settings and search results are code-split.
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));
const SearchPage = lazy(() => import('../features/search/SearchPage'));
// The map editor is the largest screen; it loads when a map is opened.
const MapPage = lazy(() =>
  import('../features/maps/MapPage').then((m) => ({ default: m.MapPage })),
);

/**
 * The hidden /dev/kit route. The lazy import lives inside this function so a production build,
 * where __MOSS_DEV_KIT__ is false and nothing calls it, drops the whole feature.
 */
function devKitRoute(): RouteObject {
  const DevKit = lazy(() => import('../features/dev/DevKit'));
  return { path: '/dev/kit', element: <DevKit /> };
}

/** The Farm screens exist only in journals whose template has a Farm section. */
function FarmRoute() {
  const usesFarm = useUsesSection('farm');
  return usesFarm ? <FarmPage /> : <NotFoundPage />;
}

function TagRedirect() {
  const { name = '' } = useParams();
  return <Navigate to={`/journal?tag=${encodeURIComponent(name)}`} replace />;
}

function Root() {
  return (
    <ServerGate>
      <CalendarProvider>
        <NewNoteProvider>
          <SetDateProvider>
            <PaletteProvider>
              <Suspense fallback={null}>
                <Outlet />
              </Suspense>
            </PaletteProvider>
          </SetDateProvider>
        </NewNoteProvider>
      </CalendarProvider>
    </ServerGate>
  );
}

/** Route table. */
export const routes: RouteObject[] = [
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      {
        element: <Shell />,
        children: [
          { path: '/', element: <TodayPage /> },
          { path: '/day/:key', element: <DayPage /> },
          { path: '/journal', element: <JournalPage /> },
          { path: '/notes/:id', element: <NotePage /> },
          { path: '/people', element: <PeoplePage /> },
          { path: '/people/:id', element: <PersonPage /> },
          {
            path: '/farm',
            element: <FarmRoute />,
            children: [{ path: ':id', element: <PlantingSheet /> }],
          },
          { path: '/maps', element: <MapsPage /> },
          { path: '/maps/:id', element: <MapPage /> },
          { path: '/search', element: <SearchPage /> },
          { path: '/settings', element: <SettingsPage /> },
          ...(__MOSS_DEV_KIT__ ? [devKitRoute()] : []),
          { path: '/tags/:name', element: <TagRedirect /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

/** The app may be served from a folder (`/mossnote/` on a project site); routes are relative to it. */
const basename = BASE_PATH === '/' ? undefined : BASE_PATH.replace(/\/$/, '');

export const createRouter = () => createBrowserRouter(routes, basename ? { basename } : {});
