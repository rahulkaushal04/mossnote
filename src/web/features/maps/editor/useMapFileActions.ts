/** Exporting a map to a file, and duplicating it. Both save first so the copy is current. */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { MapMarkerType } from '@shared/schemas/map';
import type { MapDetail } from '@shared/types';
import { useToast } from '../../../components/ui/Toast';
import { api } from '../../../lib/api';
import type { Doc } from '../engine/doc';
import { refreshMaps } from '../hooks';

export type ExportKind = 'png' | 'svg' | 'pdf' | 'json';

/** PNG exports are drawn at this multiple of the map's own size. */
const PNG_SCALE = 2;

interface Options {
  map: MapDetail;
  docRef: { current: Doc };
  markerTypes: readonly MapMarkerType[];
  saveNow: () => Promise<void>;
}

export function useMapFileActions({ map, docRef, markerTypes, saveNow }: Options) {
  const client = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);

  const exportAs = async (kind: ExportKind) => {
    setExporting(true);
    try {
      await saveNow();
      if (kind === 'json') {
        // The project file comes from the server, so it matches what is saved.
        const link = document.createElement('a');
        link.href = `/api/maps/${map.id}/export.json`;
        link.click();
        return;
      }
      // Loaded on demand: the exporter is large and most sessions never use it.
      const exporter = await import('../engine/exportMap');
      const svg = exporter.mapToSvg(docRef.current, markerTypes);
      const stem = exporter.fileStem(map.name);
      if (kind === 'svg') {
        exporter.download(new Blob([svg.svg], { type: 'image/svg+xml' }), `${stem}.svg`);
      } else if (kind === 'png') {
        exporter.download(await exporter.rasterize(svg, 'image/png', PNG_SCALE), `${stem}.png`);
      } else {
        exporter.download(await exporter.mapToPdf(svg), `${stem}.pdf`);
      }
    } catch (e) {
      toast.show({
        message: e instanceof Error ? e.message : "Couldn't export that.",
        tone: 'alert',
      });
    } finally {
      setExporting(false);
    }
  };

  const duplicate = async () => {
    try {
      await saveNow();
      const copy = await api.duplicateMap(map.id);
      void refreshMaps(client);
      toast.show({ message: `Made “${copy.name}”` });
      void navigate(`/maps/${copy.id}`);
    } catch {
      toast.show({ message: "Couldn't duplicate that map.", tone: 'alert' });
    }
  };

  return { exporting, exportAs, duplicate };
}
