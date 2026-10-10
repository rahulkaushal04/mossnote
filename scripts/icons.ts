import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

/**
 * `npx tsx scripts/icons.ts`: draws the app icons for the standalone web app from the mark in
 * `docs/assets/brand/mossnote-icon.svg` and writes them to `src/web/public`. The PNGs are committed; run this only when
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
/** The mark is drawn on a 512 unit square; it spans roughly 100 to 410. */
const VIEWBOX = 512;
const MARK = `<g fill="none" stroke="#f7f5f0" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"><path d="M132 350V268a62 62 0 0 1 124 0V350"/><path d="M256 268a62 62 0 0 1 124 0V308"/></g><circle cx="380" cy="382" r="27" fill="#f4c25b"/><g fill="#6cc1ae"><circle cx="194" cy="150" r="13"/><circle cx="318" cy="122" r="9"/><circle cx="256" cy="176" r="7"/></g>`;

interface Icon {
  file: string;
  size: number;
  /** Corner radius in viewbox units (112 is the icon's own rounding); 0 is full bleed. */
  radius: number;
  /** How much of the square the mark may use; Android's mask keeps the middle 80%. */
  markScale: number;
}

const ICONS: Icon[] = [
  { file: 'icon-192.png', size: 192, radius: 112, markScale: 1 },
  { file: 'icon-512.png', size: 512, radius: 112, markScale: 1 },
  { file: 'icon-maskable-512.png', size: 512, radius: 0, markScale: 0.8 },
  { file: 'apple-touch-icon.png', size: 180, radius: 0, markScale: 1 },
];

function svgFor({ size, radius, markScale }: Icon): string {
  const offset = (VIEWBOX - VIEWBOX * markScale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">
<rect width="${VIEWBOX}" height="${VIEWBOX}" rx="${radius}" fill="${BACKGROUND}"/>
<g transform="translate(${offset} ${offset}) scale(${markScale})">${MARK}</g>
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
