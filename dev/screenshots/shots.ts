/// <reference lib="dom" />
/**
 * Takes the documentation's screenshots of the screenshot instance, in the light and the dark
 * scheme, as `docs/screenshots/<name>-light.webp` and `-dark.webp`. Each shot opens a page as Ana,
 * the admin, waits for it to settle, and may click something first. Chromium encodes the WebP, so
 * no image tool is needed.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright-core';
import { baseUrl, progress } from './client.ts';
import type { Scenario } from './scenario.ts';

/** Where the screenshots go. */
const outputDir = join(import.meta.dir, '..', '..', 'docs', 'screenshots');

/** One screenshot: its file name, the page, and what to do before taking it. */
interface Shot {
  readonly name: string;
  readonly path: string;
  readonly before?: (page: Page) => Promise<void>;
}

/** The window's size, in CSS pixels: a laptop's 16:10, the same for every shot. */
const viewport = { width: 1440, height: 900 };

/**
 * Clicks the first control with a name, and waits for what it opens.
 *
 * @param name - The control's accessible name.
 * @returns The step.
 */
function click(name: RegExp): (page: Page) => Promise<void> {
  return async (page) => {
    await page.getByRole('button', { name }).first().click();
    await page.waitForTimeout(1500);
  };
}

/**
 * The shots, from what the scenario made.
 *
 * @param made - What the scenario made.
 * @returns The shots.
 */
function shotsOf(made: Scenario): Shot[] {
  return [
    { name: 'new-conversation', path: '/threads/new' },
    { name: 'thread', path: `/threads/${made.checkoutThread}` },
    { name: 'plan', path: `/threads/${made.planThread}` },
    { name: 'library', path: '/library' },
    { name: 'library-snapshots', path: '/library?view=snapshots' },
    { name: 'dashboard', path: `/d/${made.shop}` },
    { name: 'dashboard-incident', path: `/d/${made.checkout}` },
    { name: 'dashboard-layout', path: `/d/${made.checkout}`, before: click(/^Edit layout$/) },
    { name: 'ask', path: `/d/${made.checkout}`, before: askOpened },
    { name: 'explain', path: `/d/${made.shop}`, before: click(/^Explain /) },
    { name: 'snapshot', path: `/s/${made.snapshot}` },
    { name: 'alerts', path: '/alerts' },
    { name: 'alert', path: `/alerts/${made.alert}`, before: click(/^7 d$/) },
    { name: 'alert-thread', path: `/threads/${made.alertThread}` },
    { name: 'reports', path: '/reports' },
    { name: 'report-run', path: `/reports/${made.report}` },
    { name: 'report-thread', path: `/threads/${made.reportThread}`, before: conversationStart },
    { name: 'connectors', path: '/connectors' },
    { name: 'connector', path: '/connectors/postgres-orders' },
    { name: 'settings-model', path: '/settings/model' },
    { name: 'settings-usage', path: '/settings/usage?by=feature' },
    { name: 'settings-users', path: '/settings/users' },
    { name: 'settings-auth', path: '/settings/auth' },
    { name: 'settings-notifications', path: '/settings/notifications' },
    { name: 'settings-server', path: '/settings/server' },
    { name: 'settings-charts', path: '/settings/charts' },
    { name: 'settings-queries', path: '/settings/queries' },
    { name: 'bin', path: '/bin' },
  ];
}

/**
 * Scrolls a thread's conversation back to its first message.
 *
 * @param page - The page.
 */
async function conversationStart(page: Page): Promise<void> {
  await page.mouse.move(400, 500);
  await page.mouse.wheel(0, -100_000);
  await page.waitForTimeout(800);
}

/**
 * Opens a dashboard's Ask panel on its latest conversation.
 *
 * @param page - The page.
 */
async function askOpened(page: Page): Promise<void> {
  await click(/^Ask about this$/)(page);
  await page.getByText('What happened around 14:00?').first().click();
  await page.waitForTimeout(1500);
}

/** Who signs in to take the shots. */
interface Person {
  readonly email: string;
  readonly password: string;
}

/**
 * Signs a person in through the sign-in page, as a browser does: the session cookie is
 * `__Host-` prefixed, which a cookie set from outside the page can't be on plain http.
 *
 * @param page - The page.
 * @param person - Who signs in.
 */
async function signedIn(page: Page, person: Person): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Password').fill(person.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

/**
 * Encodes a PNG as WebP in the browser.
 *
 * @param page - A blank page of the browser.
 * @param png - The PNG.
 * @returns The WebP.
 */
async function toWebp(page: Page, png: Buffer): Promise<Buffer> {
  const dataUrl = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d')?.drawImage(image, 0, 0);
    return canvas.toDataURL('image/webp', 0.86);
  }, png.toString('base64'));
  return Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
}

/**
 * Takes every shot in one scheme.
 *
 * @param browser - The browser.
 * @param scheme - The scheme.
 * @param person - Who takes them: Ana, the admin.
 * @param shots - The shots.
 */
async function shootScheme(
  browser: Browser,
  scheme: 'light' | 'dark',
  person: Person,
  shots: readonly Shot[],
): Promise<void> {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: scheme,
    reducedMotion: 'reduce',
  });
  // The app keeps the scheme a person picked over the system's, so each shot sets its own.
  await context.addInitScript((picked) => {
    localStorage.setItem('quanthea.color-scheme', picked);
  }, scheme);
  const page = await context.newPage();
  await signedIn(page, person);
  const encoder = await context.newPage();
  for (const shot of shots) {
    await page.goto(`${baseUrl}${shot.path}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(1500);
    await shot.before?.(page);
    const png = await page.screenshot();
    writeFileSync(join(outputDir, `${shot.name}-${scheme}.webp`), await toWebp(encoder, png));
    progress(`    ${shot.name}-${scheme}.webp`);
  }
  await context.close();
}

/**
 * Takes every shot, in both schemes.
 *
 * @param made - What the scenario made.
 * @param person - Who takes them: Ana, the admin.
 */
export async function shoot(made: Scenario, person: Person): Promise<void> {
  const browser = await chromium.launch();
  try {
    const shots = shotsOf(made);
    for (const scheme of ['light', 'dark'] as const)
      await shootScheme(browser, scheme, person, shots);
  } finally {
    await browser.close();
  }
}
