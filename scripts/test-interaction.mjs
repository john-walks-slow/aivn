import { withPage } from '../e2e/lib/browser.mjs';

const BASE = 'http://127.0.0.1:37394';
await withPage(async (page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/#/play/320000/stage`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 点击展开创作工具栏
  const trigger = page.locator('.dir-trigger-btn');
  if (await trigger.count() > 0) {
    await trigger.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'docs/screenshots/r3/05-stage-expanded.png' });
    console.log('Saved 05-stage-expanded.png');
  }
});
