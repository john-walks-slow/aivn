import { withPage } from '../e2e/lib/browser.mjs';

const BASE = 'http://127.0.0.1:29594';
const OUT = 'docs/screenshots/r2';

await withPage(async (page) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. 标题画面
  await page.goto(`${BASE}/#/play/stub`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}/03-title.png` });
  console.log('Saved 03-title.png');

  // 2. 舞台 - 选项界面
  await page.goto(`${BASE}/#/play/stub/stage`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/05-stage-choices.png` });
  console.log('Saved 05-stage-choices.png');

  // 3. 舞台 - 按上键回退到上一句台词（有角色发言）
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(600);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/05-stage-dialog.png` });
  console.log('Saved 05-stage-dialog.png');
});
