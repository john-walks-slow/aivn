import { withPage } from '../e2e/lib/browser.mjs';

const BASE = 'http://127.0.0.1:37394';
await withPage(async (page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/#/play/320000/stage`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // 注入一个模拟的 pending 胶囊与展开面板来看看视觉效果
  await page.evaluate(() => {
    const badge = document.createElement('button');
    badge.className = 'prompt-queue-badge is-capsule';
    badge.innerHTML = `
      <span class="status-indicator-dot is-running"></span>
      <span class="prompt-queue-text">剧作家创作中… (1)</span>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
    `;
    document.querySelector('.stage-screen').appendChild(badge);
  });

  await page.screenshot({ path: 'docs/screenshots/r3/05-stage-pending-capsule.png' });
  console.log('Saved 05-stage-pending-capsule.png');

  // 展开态
  await page.evaluate(() => {
    document.querySelector('.prompt-queue-badge').remove();
    const panel = document.createElement('aside');
    panel.className = 'prompt-queue';
    panel.innerHTML = `
      <p class="prompt-queue-head" style="display:flex;justify-content:space-between;align-items:center;margin:0 0 8px;">
        <span style="font-weight:600;display:flex;align-items:center;gap:6px;"><span class="status-indicator-dot is-running"></span> 正在生成 · 1 项任务</span>
        <button style="border:none;background:none;color:#fff;cursor:pointer;">▲</button>
      </p>
      <ul style="list-style:none;padding:0;margin:0;">
        <li style="padding:6px 8px;background:rgba(255,255,255,0.06);border-radius:4px;display:flex;justify-content:space-between;align-items:center;">
          <span>🎭 剧作家轮次创作中…</span>
          <span style="font-size:11px;opacity:0.6;">4s</span>
        </li>
      </ul>
    `;
    document.querySelector('.stage-screen').appendChild(panel);
  });
  await page.screenshot({ path: 'docs/screenshots/r3/05-stage-pending-panel.png' });
  console.log('Saved 05-stage-pending-panel.png');
});
