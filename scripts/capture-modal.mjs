import { withPage } from '../e2e/lib/browser.mjs';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:37394';
const PLAY = process.env.PLAY ?? 'stub';
const OUT = process.env.OUT ?? 'docs/screenshots/r19';
await withPage(async (page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/#/play/${PLAY}/stage`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  for (const [label, name] of [['改写', 'edit'], ['提示', 'prompt'], ['生图', 'cg']]) {
    const btn = page.locator('.dir-btn', { hasText: label });
    if (!(await btn.count())) { console.log('no button', label); continue; }
    await btn.first().click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/modal-${name}.png` });
    console.log('saved', name);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
});
