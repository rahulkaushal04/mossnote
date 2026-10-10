import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

/**
 * Helpers for the documentation capture script (`capture.ts`): a browser at a fixed size, a
 * screenshot function that draws the same numbered boxes on every picture, and a visible cursor
 * for screen recordings. Everything is drawn on the live page just before the picture is taken
 * and removed straight after, so the screenshots show the real interface and nothing else.
 */

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const IMG_DIR = path.join(root, 'docs', 'assets', 'img');
export const VIDEO_DIR = path.join(root, 'docs', 'assets', 'video');

/** The annotation colour. It is the same in every picture and does not clash with either tint. */
const ANNOTATION = '#e8590c';

export const SIZE = { width: 1200, height: 760 };
export const PHONE = { width: 390, height: 780 };

export interface Launch {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function launch(
  options: { viewport?: { width: number; height: number }; video?: boolean; touch?: boolean } = {},
): Promise<Launch> {
  const viewport = options.viewport ?? SIZE;
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    ...(options.touch ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    ...(options.video
      ? { recordVideo: { dir: path.join(root, 'docs', 'assets', '.video-tmp'), size: viewport } }
      : {}),
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    console.log('PAGE ERROR', e.message);
  });
  return { browser, context, page };
}

export type Target = Locator | { x: number; y: number; width: number; height: number };

export interface Mark {
  target: Target;
  /** Number shown in a circle at the corner of the box. */
  n?: number;
  /** Extra room around the element, in pixels. */
  pad?: number;
}

async function rectOf(
  target: Target,
): Promise<{ x: number; y: number; width: number; height: number }> {
  if ('boundingBox' in target) {
    const box = await target.first().boundingBox();
    if (!box) throw new Error(`Cannot annotate an element that is not visible: ${String(target)}`);
    return box;
  }
  return target;
}

/** Draws the boxes, takes the picture, removes the boxes. */
export async function shot(
  page: Page,
  name: string,
  options: {
    marks?: Mark[];
    clip?: { x: number; y: number; width: number; height: number };
    full?: boolean;
    toast?: boolean;
    /** Folder for the picture instead of docs/assets/img (the README's pictures). */
    dir?: string;
    redact?: Target[];
  } = {},
): Promise<string> {
  // Let earlier toasts (such as "Now Day 13") expire first, unless the picture is of a toast.
  if (!options.toast) {
    for (
      let i = 0;
      i < 40 && (await page.locator('[role=status] .toast-in, .toast-in').count()) > 0;
      i++
    ) {
      await page.waitForTimeout(250);
    }
  }
  // Park the pointer in a corner so no button shows its hover state.
  await page.mouse.move(page.viewportSize()?.width ?? 1200, 0);
  await page.waitForTimeout(120);
  const rects = [];
  for (const mark of options.marks ?? []) {
    const box = await rectOf(mark.target);
    const pad = mark.pad ?? 4;
    rects.push({
      x: box.x - pad,
      y: box.y - pad,
      w: box.width + pad * 2,
      h: box.height + pad * 2,
      n: mark.n ?? null,
    });
  }
  const covers = [];
  for (const target of options.redact ?? []) covers.push(await rectOf(target));
  await page.evaluate(
    ({ rects: boxes, color, covers: hidden }) => {
      const layer = document.createElement('div');
      layer.id = 'doc-annotations';
      layer.setAttribute('aria-hidden', 'true');
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
      for (const r of boxes) {
        const box = document.createElement('div');
        box.style.cssText = `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;border:3px solid ${color};border-radius:8px;box-shadow:0 0 0 2px #fff, 0 0 0 5px rgba(232,89,12,.25);box-sizing:border-box`;
        if (r.n !== null) {
          const badge = document.createElement('div');
          badge.textContent = String(r.n);
          badge.style.cssText = `position:absolute;left:-14px;top:-14px;width:26px;height:26px;border-radius:50%;background:${color};color:#fff;font:700 15px/26px Inter,system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff`;
          box.appendChild(badge);
        }
        layer.appendChild(box);
      }
      for (const c of hidden) {
        const cover = document.createElement('div');
        cover.textContent = 'hidden in this picture';
        cover.style.cssText = `position:absolute;left:${c.x - 2}px;top:${c.y - 2}px;width:${c.width + 4}px;height:${c.height + 4}px;background:#6b6b66;color:#fff;font:600 14px Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center;border-radius:4px`;
        layer.appendChild(cover);
      }
      document.body.appendChild(layer);
    },
    { rects, color: ANNOTATION, covers },
  );
  const file = path.join(options.dir ?? IMG_DIR, `${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({
    path: file,
    ...(options.clip ? { clip: options.clip } : {}),
    ...(options.full ? { fullPage: true } : {}),
  });
  await page.evaluate(() => {
    document.getElementById('doc-annotations')?.remove();
  });
  return file;
}

/** A visible pointer for recordings: Playwright's video does not draw the mouse. */
export async function showCursor(page: Page): Promise<void> {
  // A plain string, so no build step can add helper functions that the page does not have.
  await page.addInitScript(`(() => {
    const dot = document.createElement('div');
    dot.setAttribute('aria-hidden', 'true');
    dot.style.cssText = 'position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(232,89,12,.35);border:3px solid #e8590c;pointer-events:none;left:-50px;top:-50px;transition:transform .08s';
    const attach = () => { document.body.appendChild(dot); };
    if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach);
    document.addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
    document.addEventListener('mousedown', () => { dot.style.transform = 'scale(.7)'; }, true);
    document.addEventListener('mouseup', () => { dot.style.transform = 'scale(1)'; }, true);
  })();`);
}

/** Moves the pointer to the middle of an element in a few steps, then clicks it. */
export async function glide(
  page: Page,
  target: Locator,
  options: { click?: boolean } = {},
): Promise<void> {
  const box = await target.first().boundingBox();
  if (!box) throw new Error('Cannot move to an element that is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
  await page.waitForTimeout(250);
  if (options.click !== false)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Saves the recording of a context as `docs/assets/video/<name>.webm`. Closes the context. */
export async function saveVideo(
  context: BrowserContext,
  page: Page,
  name: string,
): Promise<string> {
  const video = page.video();
  await context.close();
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  const file = path.join(VIDEO_DIR, `${name}.webm`);
  if (video) await video.saveAs(file);
  return file;
}

export const APP_URL = process.env.DOCS_APP_URL ?? 'http://127.0.0.1:4318';

/** First-run screen to Today, with the chosen template. */
export async function startJournal(
  page: Page,
  options: { template: 'Default' | 'Stardew Valley'; name: string },
): Promise<void> {
  await page.goto(`${APP_URL}/`);
  await page.getByRole('radio', { name: new RegExp(options.template) }).click();
  const field = page.getByLabel('Journal name');
  await field.fill(options.name);
  await page.getByRole('button', { name: 'Start my journal' }).click();
  await page.getByRole('region', { name: 'New note' }).waitFor();
}

/** Types a note into the composer and saves it with the keyboard. */
export async function writeNote(page: Page, text: string): Promise<void> {
  const box = page.getByRole('combobox', { name: 'Note' }).first();
  await box.click();
  await box.fill(text);
  await page.keyboard.press('Meta+Enter');
  await page.waitForTimeout(300);
}
