/**
 * 在真实舞台上核验五种消息框风格：把 stage.css 末尾那一节注入已部署的舞台页，
 * 逐档挂 html[data-dialog-style] 截图（不改服务端、不部署）。
 *
 * 用法：BASE_URL=https://<你的站点> node docs/features/261012-stage-style-variants/verify-on-stage.mjs [playId]
 * 输出：<仓库根>/tmp/verify/stage-{atri,card,cinema,hud,scroll,velvet}-{dark,light}.png
 *
 * 进的剧目要有正在演的剧情（挑一个 lineage 里已经有台词的剧目 id）；当前那句若是旁白，
 * 脚本会临时插一枚 .dialog-name 再截图——五种风格里名牌是重头，不摆出来看不出差别。
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/usr/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '../../..');
const BASE = process.env.BASE_URL;
if (!BASE) throw new Error('需要 BASE_URL（例：BASE_URL=https://your-host）');
const PLAY = process.argv[2] ?? 'mh';
const OUT = process.env.OUT ?? join(REPO, 'tmp/verify');
mkdirSync(OUT, { recursive: true });

const css = readFileSync(join(REPO, 'packages/stage/src/stage.css'), 'utf8');
const marker = css.indexOf('/* ══ 消息框风格');
if (marker < 0) throw new Error('stage.css 里没有「消息框风格」那一节');
const block = css.slice(marker);

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${BASE}/#/play/${PLAY}/stage`, { waitUntil: 'domcontentloaded' });
await page.locator('.theater').waitFor({ timeout: 20000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);

// 有的剧目进舞台会先停在标题画面：点一下把它演起来
if (!(await page.locator('.theater-dialog').count())) {
  await page.mouse.click(640, 400);
  await page.waitForTimeout(1200);
}
console.log('dialog present:', await page.locator('.theater-dialog').count());

await page.addStyleTag({ content: block });
await page.evaluate(() => {
  const dlg = document.querySelector('.theater-dialog');
  if (dlg && !dlg.querySelector('.dialog-name')) {
    const n = document.createElement('div');
    n.className = 'dialog-name';
    n.textContent = '真帆';
    dlg.insertBefore(n, dlg.firstChild);
  }
});

for (const theme of ['dark', 'light']) {
  for (const style of ['', 'card', 'cinema', 'hud', 'scroll', 'velvet']) {
    await page.evaluate(([t, s]) => {
      document.documentElement.dataset.uiTheme = t;
      if (s) document.documentElement.dataset.dialogStyle = s;
      else delete document.documentElement.dataset.dialogStyle;
    }, [theme, style]);
    await page.waitForTimeout(250);
    await page.locator('.theater').screenshot({ path: join(OUT, `stage-${style || 'atri'}-${theme}.png`) });
  }
}
console.log(`渲染完成 → ${OUT}`);
await browser.close();
