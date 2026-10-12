/**
 * 把 showcase.html 渲染成对照图（每个风格一张：上深色、下浅色）。
 *
 * 用法：node docs/features/261012-stage-style-variants/render.mjs
 * 输出：<仓库根>/tmp/style-variant-shots/{combo-vN,all-dark,all-light,vN-dark,vN-light}.png
 *
 * 画面与立绘取自本机数据目录（library/backgrounds、plays/mh），这两处都不进 git，
 * 换机器渲染前先改 showcase.html 顶部那两处 url()。
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/usr/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const OUT = process.env.OUT ?? join(REPO, 'tmp/style-variant-shots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.goto(`file://${join(HERE, 'showcase.html')}`, { waitUntil: 'load' });
await page.evaluate(() =>
  Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))),
);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

for (const theme of ['dark', 'light']) {
  await page.locator(`#group-${theme}`).screenshot({ path: join(OUT, `all-${theme}.png`) });
  const tiles = page.locator(`#group-${theme} .tile`);
  for (let i = 0; i < (await tiles.count()); i++) {
    const id = await tiles.nth(i).getAttribute('data-variant');
    await tiles.nth(i).screenshot({ path: join(OUT, `${id}-${theme}.png`) });
  }
}
for (const v of ['v1', 'v2', 'v3', 'v4', 'v5']) {
  await page.locator(`#combo-${v}`).screenshot({ path: join(OUT, `combo-${v}.png`) });
}
await browser.close();
console.log(`渲染完成 → ${OUT}`);
