/**
 * 把两份「纯文本/文本为主互动小说」原型渲染成对照图（每个风格一张：上深色、下浅色，含三档主题色 sweep）。
 *
 *   showcase.html        舞台 V6A 书页流（纯文本）/ V6B 书页流（带氛围背景+选肢）/ V7 音响小说（全屏 NVL）
 *   title-showcase.html  开始菜单 M6 书籍扉页 / M7 序章全屏
 *
 * 用法：node docs/features/261013-text-novel-variant/render.mjs
 * 输出：docs/features/261013-text-novel-variant/shots/{,title-}{combo-*,sweep-*}.jpg
 */
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/usr/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const MAIN_REPO = existsSync(join(REPO, 'library')) ? REPO : resolve(REPO, '../..');
const SHOTS = join(HERE, 'shots');
mkdirSync(SHOTS, { recursive: true });

// 在 worktree 中运行时临时链接主仓的 library/backgrounds 与 plays，渲染完即清理（不碰 library/.gitkeep）
const linked = [];
for (const dir of ['library/backgrounds', 'plays']) {
  const target = join(REPO, dir);
  const source = join(MAIN_REPO, dir);
  if (!existsSync(target) && existsSync(source)) {
    symlinkSync(source, target);
    linked.push(target);
  }
}

const PAGES = [
  { file: 'showcase.html',       prefix: '' },
  { file: 'title-showcase.html', prefix: 'title-' },
];

try {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

  for (const { file, prefix } of PAGES) {
    await page.goto(`file://${join(HERE, file)}`, { waitUntil: 'load' });
    await page.evaluate(() =>
      Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))),
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(450);

    const ids = await page.locator('.tile').evaluateAll((els) => [
      ...new Set(els.map((e) => e.getAttribute('data-variant'))),
    ]);
    for (const id of ids) {
      await page.locator(`#combo-${id}`).screenshot({
        path: join(SHOTS, `${prefix}combo-${id}.jpg`),
        type: 'jpeg',
        quality: 90,
      });
      const sweep = page.locator(`#sweep-${id}`);
      if ((await sweep.count()) > 0) {
        await sweep.screenshot({
          path: join(SHOTS, `${prefix}sweep-${id}.jpg`),
          type: 'jpeg',
          quality: 90,
        });
      }
    }
    console.log(`${file} → ${ids.join(' ')}`);
  }
  await browser.close();
  console.log(`渲染完成 → ${SHOTS}`);
} finally {
  for (const p of linked) rmSync(p, { force: true });
}
