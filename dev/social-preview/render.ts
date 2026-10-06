/**
 * `bun run brand:social`: renders the social preview, `docs/brand/quanthea-social-preview.png`, at
 * 1280 by 640, the size GitHub asks for. The card is `card.html`, with the brand fonts and the
 * icon inlined, drawn by headless Chromium. The website uses the same image as its share image.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const root = join(import.meta.dir, '..', '..');
const fonts = join(root, 'apps', 'site', 'node_modules');
const output = join(root, 'docs', 'brand', 'quanthea-social-preview.png');

/**
 * A file as a data URL.
 *
 * @param path - The file.
 * @param type - Its media type.
 * @returns The data URL.
 */
function dataUrl(path: string, type: string): string {
  return `data:${type};base64,${readFileSync(path).toString('base64')}`;
}

/**
 * The series along the card's foot: calm, with a short spike right after the deploy marker, in
 * the gap between the icon and the words, as the incident the demo tells. A point every 20 pixels.
 *
 * @returns The points, left to right.
 */
function seriesPoints(): [number, number][] {
  return Array.from({ length: 67 }, (_, index) => {
    const x = index * 20;
    const calm = 596 + Math.sin(index * 0.85) * 7 + Math.cos(index * 0.3) * 5;
    const spike = Math.max(0, 1 - Math.abs(x - 498) / 50) * 110;
    return [x, calm - spike];
  });
}

/**
 * A smooth path through points (Catmull-Rom as cubic Béziers).
 *
 * @param points - The points, left to right.
 * @returns The path's `d`.
 */
function smooth(points: readonly [number, number][]): string {
  const at = (index: number) => points[Math.max(0, Math.min(points.length - 1, index))] ?? [0, 0];
  const [startX, startY] = at(0);
  const segments = points.slice(1).map((_, index) => {
    const [x0, y0] = at(index - 1);
    const [x1, y1] = at(index);
    const [x2, y2] = at(index + 1);
    const [x3, y3] = at(index + 2);
    const control = `${x1 + (x2 - x0) / 6} ${y1 + (y2 - y0) / 6}, ${x2 - (x3 - x1) / 6} ${y2 - (y3 - y1) / 6}`;
    return `C ${control}, ${x2} ${y2}`;
  });
  return `M ${startX} ${startY} ${segments.join(' ')}`;
}

/**
 * The card's HTML, with the fonts, the icon and the series filled in.
 *
 * @returns The page.
 */
function card(): string {
  const series = smooth(seriesPoints());
  const values: Record<string, string> = {
    sans: dataUrl(
      join(fonts, '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2'),
      'font/woff2',
    ),
    mono: dataUrl(
      join(fonts, '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2'),
      'font/woff2',
    ),
    icon: readFileSync(join(root, 'docs', 'brand', 'quanthea-icon.svg'), 'utf8'),
    series,
    area: `${series} L 1320 640 L 0 640 Z`,
  };
  const template = readFileSync(join(import.meta.dir, 'card.html'), 'utf8');
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? '');
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await page.setContent(card());
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: output, clip: { x: 0, y: 0, width: 1280, height: 640 } });
  process.stdout.write(`The social preview is ${output}.\n`);
} finally {
  await browser.close();
}
