// 界面实拍：按名单截图到指定目录，供重设计过程逐轮比对。
// 用法：BASE_URL=http://127.0.0.1:PORT node scripts/capture-ui.mjs <输出目录> [名单过滤词...]
import { mkdirSync } from "node:fs";
import { withPage } from "../e2e/lib/browser.mjs";

const BASE = process.env.BASE_URL;
if (!BASE) throw new Error("需要 BASE_URL");
const OUT = process.argv[2] ?? "docs/screenshots/round";
const filters = process.argv.slice(3);
const PLAY = process.env.PLAY ?? "stub";
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  ["01-library", "#/"],
  ["02-settings", "#/settings"],
  ["03-title", `#/play/${PLAY}`],
  ["04-saves", `#/play/${PLAY}/saves`],
  ["05-stage", `#/play/${PLAY}/stage`],
  ["06-backlog", `#/play/${PLAY}/stage?view=backlog`],
  ["07-route", `#/play/${PLAY}/stage?view=route`],
  ["08-cg", `#/play/${PLAY}/stage?view=cg`],
  ["09-ws-chat", `#/play/${PLAY}/stage?view=workshop&workshop=1&tab=chat`],
  ["10-ws-play", `#/play/${PLAY}/stage?view=workshop&workshop=1&tab=play`],
  ["11-ws-characters", `#/play/${PLAY}/stage?view=workshop&workshop=1&tab=characters`],
  ["12-ws-memory", `#/play/${PLAY}/stage?view=workshop&workshop=1&tab=memory`],
  ["13-ws-assets", `#/play/${PLAY}/stage?view=workshop&workshop=1&tab=assets`],
  ["14-ws-files", `#/play/${PLAY}/stage?view=workshop&workshop=1&tab=files`],
  ["15-ws-agent", `#/play/${PLAY}/stage?view=workshop&workshop=1&tab=agent`],
  ["16-ws-settings", `#/play/${PLAY}/stage?view=workshop&workshop=1&tab=settings`],
];

const viewport = process.env.MOBILE
  ? { width: 390, height: 844 }
  : { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) };

await withPage(
  async (page) => {
    for (const [name, path] of SHOTS) {
      if (filters.length && !filters.some((f) => name.includes(f))) continue;
      // 每张图新开一次导航：hash 路由在同一页里切换不重挂 StageScreen 的 useState 初值
      await page.goto("about:blank");
      await page.goto(`${BASE}/${path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(Number(process.env.WAIT ?? 1800));
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${OUT}/${name}.png` });
      console.log(`${OUT}/${name}.png`);
    }
  },
  { viewport },
);
