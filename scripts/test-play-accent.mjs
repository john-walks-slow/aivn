import { withPage } from '../e2e/lib/browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:37394';
const PLAY = process.env.PLAY ?? 'stub';
const OUT = process.env.OUT ?? 'docs/screenshots/r9';

await withPage(async (page) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(`${BASE}/#/play/${PLAY}/stage?view=workshop&workshop=1&tab=play`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  const section = page.locator('h3', { hasText: '主题色' });
  if (await section.count()) await section.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/ws-accent-picker.png` });
  console.log('saved ws-accent-picker.png');

  const chip = page.locator('.accent-chip', { hasText: '樱粉' });
  if (await chip.count()) {
    await chip.first().click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/ws-accent-sakura.png` });
    console.log('picked 樱粉');
  }

  await page.goto(`${BASE}/#/play/${PLAY}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/title-sakura.png` });
  console.log('saved title-sakura.png');

  await page.goto(`${BASE}/#/play/${PLAY}/stage`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/stage-sakura.png` });
  console.log('saved stage-sakura.png');

  await page.goto(`${BASE}/#/play/${PLAY}/stage?view=workshop&workshop=1&tab=play`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const def = page.locator('.accent-chip.is-default');
  if (await def.count()) { await def.first().click(); await page.waitForTimeout(600); }
  console.log('reset');
});
