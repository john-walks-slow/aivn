// 工坊对话页滚动的实机验收：进页面落底、翻上去露「回到顶部」键、点了回顶、发话吸底。
// 用法：node e2e/chat-scroll.mjs [base-url] [输出前缀]
// 统一走 e2e/lib/browser.mjs，headless 由该处集中控制（默认 true）。
import { launchChromium } from './lib/browser.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:40774';
const OUT = process.argv[3] ?? '/tmp/aivn-chat-scroll';

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 420, height: 820 } });
const shot = async (name) => page.screenshot({ path: `${OUT}-${name}.png` });

const state = () =>
  page.evaluate(() => {
    const el = document.querySelector('.workshop-chat');
    if (!el) return null;
    const btn = document.querySelector('.chat-top-btn');
    return {
      scrollTop: Math.round(el.scrollTop),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      distanceToBottom: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
      topBtn: btn ? { visible: true, rect: btn.getBoundingClientRect().toJSON() } : null,
    };
  });

await page.goto(`${BASE}/#/play/stub/stage?view=workshop&workshop=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.evaluate(() => document.fonts.ready);

console.log('1) 进入工坊对话页：', JSON.stringify(await state()));
await shot('1-entry');

// 往上滚一段，模拟人翻历史
await page.evaluate(() => {
  document.querySelector('.workshop-chat').scrollTop = 400;
});
await page.waitForTimeout(400);
console.log('2) 往上翻之后：', JSON.stringify(await state()));
await shot('2-scrolled-up');

// 点「回到顶部」
await page.click('.chat-top-btn');
await page.waitForTimeout(900);
console.log('3) 点「回到顶部」之后：', JSON.stringify(await state()));
await shot('3-top');

// 切页签再回来：仍应落在底部
await page.evaluate(() => {
  document.querySelector('.workshop-chat').scrollTop = 0;
});
await page.click('.workshop-tabs button:nth-child(2)');
await page.waitForTimeout(600);
await page.click('.workshop-tabs button:nth-child(1)');
await page.waitForTimeout(900);
console.log('4) 从别的页签回到对话页：', JSON.stringify(await state()));
await shot('4-back-to-chat');

await browser.close();
