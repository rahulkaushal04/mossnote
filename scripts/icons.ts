import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

/**
 * `npx tsx scripts/icons.ts`: draws the app icons for the standalone web app from the mark in
 * `favicon.svg` and writes them to `src/web/public`. The PNGs are committed; run this only when
 * the mark changes.
 *
 * - `icon-192.png`, `icon-512.png`: the rounded icon, for the install prompt.
 * - `icon-maskable-512.png`: full bleed with the mark inside the safe zone, which Android crops.
 * - `apple-touch-icon.png`: full bleed, because iOS rounds the corners itself.
 */
const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'web',
  'public',
);

const BACKGROUND = '#1f5f56';
const MARK = '#f7f5f0';
const MARK_PATH = 'M9 23V9h2.4l4.6 8 4.6-8H23v14h-2.6v-9l-3.4 6h-2l-3.4-6v9z';
/** The favicon is drawn on a 32 unit square; the mark spans roughly 9 to 23. */
const VIEWBOX = 32;

interface Icon {
  file: string;
  size: number;
  /** Corner radius in viewbox units; 0 is full bleed. */
  radius: number;
  /** How much of the square the mark may use; Android's mask keeps the middle 80%. */
  markScale: number;
}

const ICONS: Icon[] = [
  { file: 'icon-192.png', size: 192, radius: 9, markScale: 1 },
  { file: 'icon-512.png', size: 512, radius: 9, markScale: 1 },
  { file: 'icon-maskable-512.png', size: 512, radius: 0, markScale: 0.8 },
  { file: 'apple-touch-icon.png', size: 180, radius: 0, markScale: 1 },
];

function svgFor({ size, radius, markScale }: Icon): string {
  const offset = (VIEWBOX - VIEWBOX * markScale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">
<rect width="${VIEWBOX}" height="${VIEWBOX}" rx="${radius}" fill="${BACKGROUND}"/>
<path transform="translate(${offset} ${offset}) scale(${markScale})" fill="${MARK}" d="${MARK_PATH}"/>
</svg>`;
}

const browser = await chromium.launch();
try {
  for (const icon of ICONS) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    await page.setContent(`<body style="margin:0;background:transparent">${svgFor(icon)}</body>`);
    const png = await page.screenshot({ omitBackground: true, type: 'png' });
    fs.writeFileSync(path.join(publicDir, icon.file), png);
    await page.close();
    process.stdout.write(`${icon.file}\n`);
  }
} finally {
  await browser.close();
}
