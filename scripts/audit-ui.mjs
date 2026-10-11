// 界面体检：零错误扫查 + 横向溢出 + 命中区/最小字号 + 对比度（含占位符）。
//
// 用法：
//   BASE_URL=http://localhost:PORT node scripts/audit-ui.mjs                 # 默认 390 与 1440 两档
//   BASE_URL=... THEME=dark node scripts/audit-ui.mjs                       # 深色宿主主题（写 localStorage 后重载）
//   BASE_URL=... WIDTHS=390,768,1440 node scripts/audit-ui.mjs
//   BASE_URL=... PLAY=320000 node scripts/audit-ui.mjs
//
// 为什么要有这个脚本：这三类问题（控制台报错、横向溢出、低对比度）都不会被单元测试抓到——
// 它们只在真浏览器的计算样式里成立。写死一次，重设计期间每轮跑一遍，比靠肉眼翻截图可靠。
import { withPage } from "../e2e/lib/browser.mjs";

const BASE = process.env.BASE_URL;
if (!BASE) throw new Error("需要 BASE_URL（例：BASE_URL=http://localhost:37394）");
const PLAY = process.env.PLAY ?? "320000";
const THEME = process.env.THEME ?? "light";
const WIDTHS = (process.env.WIDTHS ?? "390,1440").split(",").map((w) => Number(w.trim()));
const IGNORE = [/favicon/i, /React DevTools/i, /\[vite\] connect/i, /WebSocket connection to .* failed/i];

// 已判定「就这样」的：次要层级文字本来就该比正文淡，且都见过实拍确认可读。
// 列在这里是为了让脚本的退出码有意义——只报新出现的问题，不做复读机。
const ACCEPTED = [
  { re: /atri-sub/, why: "标题页副标题：ATRI 那套次要字，压在插画上靠字重与投影读，不再加深" },
  { re: /muted\.small/, why: "空态说明：次要层级，与正文拉开档次" },
  { re: /setting-card-summary/, why: "卡片副标题：4.34:1，差 AA 0.16，属次要层级" },
  { re: /atri-label/, why: "ATRI 那套菜单字：参考画面本身如此，选中态另有焦点框" },
  {
    re: /qm-label/,
    why: "舞台右下角快捷菜单：探针读不懂那枚玻璃胶囊的渐变底（只认元素自身可解析的背景），" +
      "一路退到页面底色，于是「白字压白纸」算成 1.16；实际是白字压深海蓝玻璃，实拍约 6.5:1",
  },
];

const PAGES = [
  ["剧目库", "#/"],
  ["设置", "#/settings"],
  ["标题", `#/play/${PLAY}`],
  ["周目", `#/play/${PLAY}/saves`],
  ["舞台", `#/play/${PLAY}/stage`],
  ["回顾", `#/play/${PLAY}/stage?view=backlog`],
  ["路线", `#/play/${PLAY}/stage?view=route`],
  ["画廊", `#/play/${PLAY}/stage?view=cg`],
  ["工坊-对话", `#/play/${PLAY}/stage?view=workshop&workshop=1&tab=chat`],
  ["工坊-剧目", `#/play/${PLAY}/stage?view=workshop&workshop=1&tab=play`],
  ["工坊-角色", `#/play/${PLAY}/stage?view=workshop&workshop=1&tab=characters`],
  ["工坊-记忆", `#/play/${PLAY}/stage?view=workshop&workshop=1&tab=memory`],
  ["工坊-素材", `#/play/${PLAY}/stage?view=workshop&workshop=1&tab=assets`],
  ["工坊-文件", `#/play/${PLAY}/stage?view=workshop&workshop=1&tab=files`],
  ["工坊-Agent", `#/play/${PLAY}/stage?view=workshop&workshop=1&tab=agent`],
];

/** 两件事：算对比度、找越界与过小的目标。全部在页面里跑，避免来回传 DOM。 */
const PROBE = (minTarget) => {
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // 站点颜色多出自 color-mix()，computed 常是 `color(srgb 0.87 0.90 0.95)` 或
  // `color(srgb 0.11 0.35 0.65 / 0.12)` 这种形式：分量是 0~1，斜杠后可能还有透明度。
  // 按 0~255 读、或漏掉斜杠后的 alpha，都会把浅底/淡底算成近黑——两头都踩过。
  const readColor = (c) => {
    if (!c || c === "transparent") return { rgb: [0, 0, 0], a: 0 };
    const modern = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)/i.exec(c);
    if (modern) {
      const a = modern[4] === undefined ? 1 : modern[4].endsWith("%") ? Number(modern[4].slice(0, -1)) / 100 : Number(modern[4]);
      return { rgb: [modern[1], modern[2], modern[3]].map((v) => Number(v) * 255), a };
    }
    const m = c.match(/[\d.]+/g);
    if (!m) return null;
    return { rgb: m.slice(0, 3).map(Number), a: m.length > 3 ? Number(m[3]) : 1 };
  };
  const parse = (c) => readColor(c)?.rgb ?? null;
  const over = (fg, bg) => fg.rgb.map((v, i) => v * fg.a + bg[i] * (1 - fg.a));
  /** 沿祖先链把半透明底色逐层压到不透明为止，得到真正的视觉底色。 */
  const bgOf = (el) => {
    const stack = [];
    let n = el;
    let glass = false;
    let art = false;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      // 磨砂玻璃（backdrop-filter）后面的底色取决于它背后那张图，computed 里读不出来——
      // 这类一律判「算不准」而不是硬算成深色，否则整条舞台 chrome 都是假警报。
      if (cs.backdropFilter && cs.backdropFilter !== "none") glass = true;
      // 插画/照片底（url(...) 且上面没有实色）：字压在画上靠投影读，探针只会拿纸面去算，
      // 必然误报（标题页剧名、EXPORT/DELETE 都栽在这）。纯渐变的底不算，那是可控的。
      if (cs.backgroundImage && cs.backgroundImage.includes("url(") && stack.every((c) => c.a < 0.999)) art = true;
      const c = readColor(cs.backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a >= 0.999) break;
      }
      n = n.parentElement;
    }
    let base = [255, 255, 255];
    for (let i = stack.length - 1; i >= 0; i -= 1) base = over(stack[i], base);
    return { rgb: base, glass, art };
  };
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
  };
  const lowContrast = [];
  const tiny = [];
  const vw = window.innerWidth;
  // 命中区只按触摸口径算：桌面上鼠标点 24px 的图标是常态，拿 32px 去要求桌面只会满屏假警报。
  const touch = vw <= 720;
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.5) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (touch && (el.tagName === "BUTTON" || el.getAttribute("role") === "button")) {
      // 舞台上的器具（台词条底缘快捷行、左上角「舞台⇄工坊」、导演栏）是有意做密的 HUD，
      // 与宿主页面的表单按钮不同口径：宿主按 32px 收，舞台按 26px 兜底即可。
      const inStage = el.closest(".theater, .stage-root, .stage-panel, .studio-rail-switch, .theater-bar, .studio-rail, .studio-exit-btn, .stage-view-segmented");
      const floor = inStage ? 26 : minTarget;
      if (r.height < floor && r.top < window.innerHeight) {
        tiny.push(`${(el.className || "").toString().split(" ")[0] || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}「${el.textContent.trim().slice(0, 10)}」`);
      }
    }
    if (el.children.length) continue;
    const text = (el.textContent || "").trim();
    if (text.length < 2) continue;
    const fgRaw = readColor(cs.color);
    if (!fgRaw) continue;
    const bgInfo = bgOf(el);
    if (bgInfo.glass || bgInfo.art) continue; // 玻璃/插画上的字按截图判断，不在这里报
    const bg = bgInfo.rgb;
    const fg = fgRaw.a >= 1 ? fgRaw.rgb : over(fgRaw, bg);
    const size = parseFloat(cs.fontSize);
    const isBig = size >= 19 || (size >= 15 && Number(cs.fontWeight) >= 600);
    const floor = isBig ? 3 : 4.5;
    const got = ratio(fg, bg);
    if (got < floor) lowContrast.push(`${(el.className || "").toString().split(" ").slice(0, 2).join(".")} ${got}<${floor}「${text.slice(0, 14)}」`);
  }
  const placeholders = [];
  for (const el of document.querySelectorAll("input, textarea")) {
    if (!el.placeholder || !el.offsetParent) continue;
    const raw = readColor(getComputedStyle(el, "::placeholder").color);
    if (!raw) continue;
    const phInfo = bgOf(el);
    if (phInfo.glass || phInfo.art) continue;
    const phBg = phInfo.rgb;
    const got = ratio(raw.a >= 1 ? raw.rgb : over(raw, phBg), phBg);
    if (got < 4.5) placeholders.push(`${el.placeholder.slice(0, 12)} ${got}`);
  }
  const overflow = document.documentElement.scrollWidth - vw;
  return {
    overflow,
    lowContrast: [...new Set(lowContrast)].slice(0, 6),
    tiny: [...new Set(tiny)].slice(0, 6),
    placeholders: [...new Set(placeholders)].slice(0, 4),
  };
};

let failures = 0;
for (const width of WIDTHS) {
  const height = width <= 430 ? 844 : width <= 1024 ? 1024 : 900;
  await withPage(
    async (page) => {
      const errors = [];
      const onError = (e) => errors.push(String(e).slice(0, 140));
      const onConsole = (m) => {
        if (m.type() !== "error" && m.type() !== "warning") return;
        const t = m.text();
        if (!IGNORE.some((re) => re.test(t))) errors.push(`${m.type()}: ${t.slice(0, 140)}`);
      };
      page.on("pageerror", onError);
      page.on("console", onConsole);
      await page.goto(`${BASE}/#/settings`, { waitUntil: "domcontentloaded" });
      await page.evaluate((t) => localStorage.setItem("aivn:ui-theme-mode", t), THEME);
      console.log(`\n===== ${width}×${height}（宿主主题 ${THEME}）=====`);
      for (const [name, path] of PAGES) {
        errors.length = 0;
        await page.goto("about:blank");
        await page.goto(`${BASE}/${path}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(2200);
        const r = await page.evaluate(PROBE, 32);
        const bad = [];
        if (errors.length) bad.push(`控制台 ${errors.length}：${errors[0]}`);
        if (r.overflow > 1) bad.push(`横向溢出 ${r.overflow}px`);
        const low = r.lowContrast.filter((line) => !ACCEPTED.some((a) => a.re.test(line)));
        if (low.length) bad.push(`低对比 ${low.slice(0, 2).join(" / ")}`);
        if (r.placeholders.length) bad.push(`占位符 ${r.placeholders.join(" / ")}`);
        if (r.tiny.length) bad.push(`小目标 ${r.tiny.slice(0, 3).join(" / ")}`);
        if (bad.length) failures += 1;
        console.log(`${bad.length ? "✗" : "✓"} ${name.padEnd(11)} ${bad.join(" ｜ ")}`);
      }
      page.off("pageerror", onError);
      page.off("console", onConsole);
    },
    { viewport: { width, height } },
  );
}
console.log(failures ? `\n有 ${failures} 处需要看：上面每行都写了是什么、在哪。` : "\n全部通过。");
process.exit(failures ? 1 : 0);
