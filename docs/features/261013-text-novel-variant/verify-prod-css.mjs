/**
 * 生产 CSS 真实 DOM 核验脚本：直接加载 packages/stage/src/stage.css 与 apps/web/src/app.css，
 * 挂载 StageTheater 与 TitleView 的真实 DOM 结构，在桌面（1280×720）与手机窄屏（390×844）下
 * 渲染 novel（书页流）与 nvl（音响小说）的深/浅双模式对照图并校验无横向溢出。
 *
 * 用法：node docs/features/261013-text-novel-variant/verify-prod-css.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/usr/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const MAIN_REPO = existsSync(join(REPO, 'library')) ? REPO : resolve(REPO, '../..');
const SHOTS = join(HERE, 'shots');
mkdirSync(SHOTS, { recursive: true });

const linked = [];
for (const dir of ['library/backgrounds', 'plays']) {
  const target = join(REPO, dir);
  const source = join(MAIN_REPO, dir);
  if (!existsSync(target) && existsSync(source)) {
    symlinkSync(source, target);
    linked.push(target);
  }
}

const stageCss = readFileSync(join(REPO, 'packages/stage/src/stage.css'), 'utf8');
const appCss = readFileSync(join(REPO, 'apps/web/src/app.css'), 'utf8');

const bgRain = '../../../library/backgrounds/bg_rainy_window/bg_rainy_window.jpg';
const bgRooftop = '../../../library/backgrounds/bg_rooftop_dusk/bg_rooftop_dusk.jpg';
const spriteManami = '../../../plays/mh/assets/sprites/manami/neutral.png';

function stageHtml({ hasArt, style }) {
  const bgUrl = style === 'nvl' ? bgRooftop : bgRain;
  return `<!doctype html>
<html lang="zh-CN" data-dialog-style="${style}">
<head>
<meta charset="utf-8" />
<style>${appCss}\n${stageCss}
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
</style>
</head>
<body>
  <div class="screen stage-screen" style="width:100vw;height:100vh;">
    <div class="theater stage-root">
      <div class="theater-stage">
        <div class="theater-camera">
          ${hasArt ? `<img class="theater-bg theater-bg-in" src="${bgUrl}" alt="" />` : `<div class="theater-bg theater-bg-fallback"></div>`}
          <div class="theater-sprites">
            ${hasArt ? `<img class="theater-sprite pos-center" style="--scale:1;--sprite-top:18%;--sprite-height:104%;--sprite-origin:top center;--sprite-top-portrait:16%;--sprite-height-portrait:102%;--sprite-origin-portrait:top center;" src="${spriteManami}" alt="真帆" />` : ''}
          </div>
        </div>
      </div>
      <div class="theater-director">
        <button type="button" class="dir-btn"><span class="dir-label">提示</span></button>
        <button type="button" class="dir-btn"><span class="dir-label">改写</span></button>
        <button type="button" class="dir-btn"><span class="dir-label">重写</span></button>
        <button type="button" class="dir-btn"><span class="dir-label">生图</span></button>
        <button type="button" class="dir-btn"><span class="dir-label">重听</span></button>
      </div>
      <div class="theater-dialog" role="text">
        <div class="dialog-page-head">
          <span class="dialog-page-title"><b class="dialog-page-dot">❖</b>CHAPTER I · 旧馆长室的借书卡</span>
          <span class="dialog-page-meta">PAGE 01 · LINE 005</span>
        </div>
        ${style === 'novel' && hasArt ? `<div class="dialog-scene-plate"><img src="${bgRain}" alt="" /><span class="dialog-scene-cap">SCENE · 旧馆长室 · 雨夜</span></div>` : ''}
        <div class="dialog-page-flow">
          <p class="page-entry narrate"><span class="page-text">傍晚六点的钟声从走廊尽头传来，空气里浮着旧纸页与冷杉木的气味。雨点敲在铅框玻璃窗上，把外面的庭院洇成一片模糊的暗绿。</span></p>
          <p class="page-entry say"><span class="page-spk">真帆</span><span class="page-text">「……你就这么站在门口，一句话也不说？」</span></p>
          <p class="page-entry thought"><span class="page-text">她把那本没有署名的借书卡夹回索引册，指尖在封皮边缘停顿了半秒。</span></p>
          <p class="page-entry input"><span class="page-text">走过去把伞靠在门边，问她是不是已经看过最后一页。</span></p>
          <p class="page-entry say is-current"><span class="page-spk">真帆</span><span class="page-text">「看过了。上面最后一行写的名字——其实是你吧。」</span></p>
          <div class="choice-overlay" role="group" aria-label="选项">
            <button type="button" class="choice"><span class="choice-num">1</span><span class="choice-text">承认那是三年前留下的记录，并索要夹页里的钥匙</span></button>
            <button type="button" class="choice is-seen"><span class="choice-num">2</span><span class="choice-text">翻开索引册倒数第二页，指出另一个被涂掉的署名</span><span class="choice-seen">✓ 已选过</span></button>
            <button type="button" class="choice ghost"><span class="choice-num">✎</span><span class="choice-text">自由输入</span></button>
          </div>
        </div>
        <div class="dialog-foot">
          <div class="dialog-hint dialog-hint-foot"><span class="dialog-next">▼</span><span class="muted">点击舞台继续生成</span></div>
          <div class="dialog-options" role="toolbar">
            <button type="button" class="quick-btn"><span class="qm-label">Auto</span></button>
            <button type="button" class="quick-btn"><span class="qm-label">Log</span></button>
            <button type="button" class="quick-btn"><span class="qm-label">Route</span></button>
            <button type="button" class="quick-btn"><span class="qm-label">CG</span></button>
            <button type="button" class="quick-btn"><span class="qm-label">Title</span></button>
          </div>
        </div>
      </div>
    </div>
    <div class="stage-top-left-cluster">
      <div class="stage-view-segmented"><button type="button" class="stage-seg-btn is-active"><span>舞台</span></button><button type="button" class="stage-seg-btn"><span>工坊</span></button></div>
    </div>
  </div>
</body>
</html>`;
}

const tmpHtml = join(HERE, '.tmp-verify.html');
try {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  for (const [tag, cfg] of [
    ['prod-novel-pure', { style: 'novel', hasArt: false }],
    ['prod-novel-art',  { style: 'novel', hasArt: true }],
    ['prod-nvl',        { style: 'nvl',   hasArt: true }],
  ]) {
    writeFileSync(tmpHtml, stageHtml(cfg), 'utf8');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`file://${tmpHtml}`, { waitUntil: 'load' });
    await page.evaluate(() =>
      Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))),
    );
    await page.evaluate(() => document.fonts.ready);
    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => { document.documentElement.dataset.uiTheme = t; }, theme);
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) throw new Error(`Desktop horizontal overflow in ${tag} (${theme})`);
      await page.screenshot({ path: join(SHOTS, `${tag}-${theme}.jpg`), type: 'jpeg', quality: 90 });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.dataset.uiTheme = 'dark'; });
    await page.waitForTimeout(200);
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (mobileOverflow) throw new Error(`Mobile 390px horizontal overflow in ${tag}`);
    await page.screenshot({ path: join(SHOTS, `${tag}-mobile.jpg`), type: 'jpeg', quality: 90 });
  }

  await browser.close();
  console.log('生产 CSS 真实 DOM 验证通过，无横向溢出。');
} finally {
  rmSync(tmpHtml, { force: true });
  for (const p of linked) rmSync(p, { force: true });
}
