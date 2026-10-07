import { useMemo } from 'react';
import type { MapMarkerType } from '@shared/schemas/map';
import { useSettings } from './useSettings';

const NONE: MapMarkerType[] = [];

/** The marker types the person made. Empty until they make some. */
export function useMarkerTypes(): MapMarkerType[] {
  const settings = useSettings();
  return useMemo(() => settings.data?.markerTypes ?? NONE, [settings.data]);
}
