import { withPage } from '../e2e/lib/browser.mjs';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:37394';
const PLAY = process.env.PLAY ?? '320000';
const OUT = process.env.OUT ?? 'docs/screenshots/r13';
await withPage(async (page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/#/play/${PLAY}/stage?view=route`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/07-route.png` });
  console.log('saved route');
  const node = page.locator('.route-node').nth(2);
  if (await node.count()) {
    await node.hover();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/07-route-hover.png` });
    console.log('saved route-hover');
  }
});
