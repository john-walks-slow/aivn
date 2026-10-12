/**
 * 把两份原型渲染成对照图（每个风格一张：上深色、下浅色）。
 *
 *   showcase.html        消息框五种风格
 *   title-showcase.html  与之同源的开始菜单五种风格
 *
 * 用法：node docs/features/261012-stage-style-variants/render.mjs
 * 输出：<仓库根>/tmp/style-variant-shots/{,title-}{combo-vN,all-dark,all-light,vN-dark,vN-light}.png
 *
 * 画面取自本机数据目录（library/backgrounds、plays/mh），这两处都不进 git，
 * 换机器渲染前先改两份 html 里的 url()。
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/usr/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const OUT = process.env.OUT ?? join(REPO, 'tmp/style-variant-shots');
mkdirSync(OUT, { recursive: true });

const PAGES = [
  { file: 'showcase.html', prefix: '' },
  { file: 'title-showcase.html', prefix: 'title-' },
];

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

for (const { file, prefix } of PAGES) {
  await page.goto(`file://${join(HERE, file)}`, { waitUntil: 'load' });
  await page.evaluate(() =>
    Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  const ids = await page.locator('.tile').evaluateAll((els) => [
    ...new Set(els.map((e) => e.getAttribute('data-variant'))),
  ]);
  for (const theme of ['dark', 'light']) {
    await page.locator(`#group-${theme}`).screenshot({ path: join(OUT, `${prefix}all-${theme}.png`) });
    const tiles = page.locator(`#group-${theme} .tile`);
    for (let i = 0; i < (await tiles.count()); i++) {
      const id = await tiles.nth(i).getAttribute('data-variant');
      await tiles.nth(i).screenshot({ path: join(OUT, `${prefix}${id}-${theme}.png`) });
    }
  }
  for (const id of ids) {
    await page.locator(`#combo-${id}`).screenshot({ path: join(OUT, `${prefix}combo-${id}.png`) });
  }
  console.log(`${file} → ${ids.join(' ')}`);
}
await browser.close();
console.log(`渲染完成 → ${OUT}`);
