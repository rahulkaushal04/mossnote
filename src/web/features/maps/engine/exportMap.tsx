import { renderToStaticMarkup } from 'react-dom/server';
import type { MapMarkerType } from '@shared/schemas/map';
import { saveBlob } from '../../../lib/saveFile';
import { SceneView } from '../render/SceneView';
import { EXPORT_INK, EXPORT_PAPER, exportColor } from '../render/colors';
import { contentBox, objectsOf, type Doc } from './doc';

export interface ExportedSvg {
  svg: string;
  width: number;
  height: number;
}

/**
 * A standalone SVG of the map. Colours are fixed (no theme), pin names are placed beside pins, and
 * the SVG stays vector, so it prints and scales cleanly.
 */
export function mapToSvg(
  doc: Doc,
  markerTypes: readonly MapMarkerType[],
  options: { background?: boolean } = {},
): ExportedSvg {
  const box = contentBox(doc) ?? { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  const width = Math.round(box.maxX - box.minX);
  const height = Math.round(box.maxY - box.minY);
  const objs = objectsOf(doc, 1);
  const body = renderToStaticMarkup(
    <SceneView
      doc={doc}
      objs={objs}
      colorOf={exportColor}
      paper={EXPORT_PAPER}
      ink={EXPORT_INK}
      scale={1}
      markerTypes={markerTypes}
      toScreen={(x, y) => [x - box.minX, y - box.minY]}
    />,
  );
  const bg =
    options.background === false
      ? ''
      : `<rect x="${box.minX}" y="${box.minY}" width="${width}" height="${height}" fill="${EXPORT_PAPER}"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${box.minX} ${box.minY} ${width} ${height}">` +
    `${bg}${body}</svg>`;
  return { svg, width, height };
}

/** Render an SVG string to a canvas at `pixelRatio` and return PNG or JPEG bytes. */
export async function rasterize(
  { svg, width, height }: ExportedSvg,
  type: 'image/png' | 'image/jpeg',
  pixelRatio = 2,
): Promise<Blob> {
  const maxSide = 8192;
  const ratio = Math.min(pixelRatio, maxSide / Math.max(width, height, 1));
  const img = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => {
      resolve();
    };
    img.onerror = () => {
      reject(new Error("Couldn't draw the map."));
    };
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Couldn't draw the map.");
  ctx.fillStyle = EXPORT_PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Couldn't save the picture."));
      },
      type,
      0.92,
    );
  });
}

/** A one-page PDF holding the map as a JPEG, sized to the map (at 72 points per 96 pixels). */
export async function mapToPdf(exported: ExportedSvg): Promise<Blob> {
  const jpeg = new Uint8Array(await (await rasterize(exported, 'image/jpeg', 2)).arrayBuffer());
  return buildPdf(jpeg, exported.width, exported.height);
}

/** Minimal PDF 1.4: one page, one DCT-compressed image drawn over the whole page. */
export function buildPdf(jpeg: Uint8Array, pxW: number, pxH: number): Blob {
  const w = Math.round((pxW * 72) / 96);
  const h = Math.round((pxH * 72) / 96);
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string | Uint8Array[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    if (typeof body === 'string') push(body);
    else for (const b of body) push(b);
    push('\nendobj\n');
  };
  push('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  object(4, [
    enc.encode(
      `<< /Type /XObject /Subtype /Image /Width ${Math.round(pxW * 2)} /Height ${Math.round(pxH * 2)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    ),
    jpeg,
    enc.encode('\nendstream'),
  ]);
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  object(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xrefAt = length;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (let n = 1; n <= 5; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

export const download = saveBlob;

/** A safe file name from a map name. */
export const fileStem = (name: string): string =>
  name
    .replace(/[^\p{L}\p{N}._ -]+/gu, '')
    .trim()
    .slice(0, 60) || 'map';
