import { withPage } from '../e2e/lib/browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:37394';
const PLAY = process.env.PLAY ?? '320000';
const OUT = process.env.OUT ?? 'docs/screenshots/r8';

await withPage(async (page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/#/play/${PLAY}/stage`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);

  // 回退几句，让本地 playback.history 有内容
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${OUT}/05-stage-rewound.png` });

  // 打开回顾并切到「台词」（本地流水）
  await page.goto(`${BASE}/#/play/${PLAY}/stage?view=backlog`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const tab = page.locator('.seg-btn', { hasText: '台词' });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: `${OUT}/06-backlog.png` });
  console.log('saved', `${OUT}/06-backlog.png`);

  // 悬停一条，看动词组浮出
  const row = page.locator('.bl-line, .bl-narrate').first();
  if (await row.count()) {
    await row.hover();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/06-backlog-hover.png` });
    console.log('saved', `${OUT}/06-backlog-hover.png`);
  }
});
