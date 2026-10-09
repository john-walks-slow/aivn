// e2e 共享浏览器启动器。
//
// 为什么需要它：全家族此前的浏览器脚本各自 `chromium.launch({...})`，headless
// 与否取决于各自有没有写那个字段，无法统一审查。实测确认 stage-ai 的
// check-chat-scroll.mjs 走 Playwright 默认（headless=true），但 camoufox 那两条
// 路径是显式 headed（~/.config/camoufox-mcp/settings.json 与 flowcli-api
// engine.py 的 --headed --persistent）。把启动收敛到这里，headless 就成了
// 默认且唯一需要审查的地方。
//
// 用法：
//   import { launchChromium } from '../lib/browser.mjs';
//   const browser = await launchChromium();          // headless（默认）
//   const browser = await launchChromium({ headed: true });  // 需人眼看 VNC 时才用

import { chromium } from '/usr/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';

// 资源受限设备上的固定参数：--no-sandbox 是 root 容器必需，
// --disable-dev-shm-usage 避免 /dev/shm 过小导致崩溃。
const BASE_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];

export async function launchChromium({ headed = false, args = [], ...rest } = {}) {
  const headless = !headed;
  if (headed && !process.env.DISPLAY) {
    throw new Error('headed 模式需要 DISPLAY（VNC 桌面通常是 :1）；纯回归测试请用 headless');
  }
  return chromium.launch({
    headless,
    args: [...BASE_ARGS, ...args],
    ...rest,
  });
}

// 带上下文与页面的便捷封装；调用方负责 close，或交给 withPage 自动收尾。
export async function withPage(fn, { headed = false, viewport = { width: 1280, height: 720 }, ...opts } = {}) {
  const browser = await launchChromium({ headed, ...opts });
  try {
    const context = await browser.newContext({ viewport });
    try {
      return await fn(await context.newPage(), context);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
