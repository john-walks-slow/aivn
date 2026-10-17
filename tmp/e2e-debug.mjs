import { chromium } from "/usr/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs";
const WEB = "http://127.0.0.1:54684";
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 160)));
page.on("response", (r) => {
  if (r.status() >= 400) console.log("[http]", r.status(), r.url().slice(0, 120));
});
await page.goto(`${WEB}/#/play/attach-demo/stage?view=workshop&tab=chat&workshop=1`, {
  waitUntil: "networkidle",
});
await page.waitForSelector(".workshop-input textarea");
await page.setInputFiles('.workshop-input input[type="file"]', ["/tmp/e2e-attach/封面参考.png"]);
await page.waitForFunction(() => document.querySelectorAll(".chat-attachment").length === 1);
await page.fill(".workshop-input textarea", "第二张：看看这条消息的附件渲染");
await page.click(".workshop-input button.send-btn");
await page.waitForTimeout(4000);
console.log(
  "transcript classes:",
  await page.$$eval(".workshop-chat > *", (els) => els.map((el) => el.className).slice(-6)),
);
console.log(
  "in-message chips:",
  await page.$$eval(".chat-attachments.in-message .chat-attachment-name", (els) =>
    els.map((e) => e.textContent),
  ),
);
console.log("error banner:", await page.$$eval(".error-banner", (els) => els.map((e) => e.textContent)));
await page.screenshot({ path: "/root/projects/stage-ai/.worktrees/workshop-attachments-v2/tmp/shots/debug-send.png" });
await browser.close();
