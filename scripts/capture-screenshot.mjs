import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const URL = process.env.APP_URL || 'http://localhost:8000';
const OUT_FULL = 'docs/screenshots/analyzer-hero.png';
const OUT_FOLD = 'docs/screenshots/analyzer-hero-viewport.png';
const SETTLE_MS = Number(process.env.SETTLE_MS || 5000);
const TAILWIND_LOCAL = 'node_modules/@tailwindcss/browser/dist/index.global.js';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
    '--disable-features=IsolateOrigins,site-per-process',
  ],
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 1800 },
  deviceScaleFactor: 2,
});

const page = await context.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('[page error]', msg.text());
});

// Sandboxed environments often block the Tailwind Play CDN. If a local
// @tailwindcss/browser bundle is available, serve it in place of the CDN
// request so utility classes render correctly in the screenshot.
if (existsSync(TAILWIND_LOCAL)) {
  const tailwindBody = await readFile(TAILWIND_LOCAL);
  await page.route('**/cdn.tailwindcss.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: tailwindBody,
    }),
  );
  await page.route('https://cdn.tailwindcss.com', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: tailwindBody,
    }),
  );
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('#play-pause-btn', { state: 'visible' });

// Click Play to start the demo audio. The handler in main.js wires this to
// resume the AudioContext and start the analyser pipeline.
await page.click('#play-pause-btn');

// Let the spectrogram ring buffer fill, peak hold settle, derived metrics tick
// (~10 Hz) so all panels show real data.
await page.waitForTimeout(SETTLE_MS);

await page.screenshot({ path: OUT_FULL, fullPage: true, type: 'png' });
await page.screenshot({ path: OUT_FOLD, fullPage: false, type: 'png' });

console.log(`Saved ${OUT_FULL} and ${OUT_FOLD}`);

await browser.close();
