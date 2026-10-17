// 工坊附件链路的实拍脚本：选文件 → 草稿条 → 发送 → 消息里的附件条 → 文件页里的 resources/
import { chromium } from "/usr/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs";

const WEB = process.env.WEB_URL ?? "http://127.0.0.1:54684";
const SHOTS = "/root/projects/stage-ai/.worktrees/workshop-attachments-v2/tmp/shots";
const PNG = "/tmp/e2e-attach/封面参考.png";
const EPUB = "/tmp/e2e-attach/原作 测试.epub";

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console]", m.text().slice(0, 200));
});

const step = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log("shot", name);
};

await page.goto(`${WEB}/#/play/attach-demo/stage?view=workshop&tab=chat&workshop=1`, {
  waitUntil: "networkidle",
});
await page.evaluate(() => document.fonts.ready);
await page.waitForSelector(".workshop-input textarea", { timeout: 15000 });
await step("01-composer-empty");

// 选文件（隐藏 input）：一张图 + 一本 epub
await page.setInputFiles('.workshop-input input[type="file"]', [PNG, EPUB]);
await page.waitForSelector(".chat-attachment", { timeout: 15000 });
await page.waitForFunction(() => document.querySelectorAll(".chat-attachment").length === 2);
console.log(
  "chips:",
  await page.$$eval(".chat-attachment", (els) =>
    els.map((el) => el.textContent?.trim() ?? ""),
  ),
);
await step("02-draft-strip");

// 粘贴一张图：构造一个 File 塞进 clipboardData
await page.evaluate(async () => {
  const res = await fetch("/plays/attach-demo/resources/" + encodeURIComponent("封面参考.png"));
  const blob = await res.blob();
  const file = new File([blob], "粘贴的图.png", { type: "image/png" });
  const dt = new DataTransfer();
  dt.items.add(file);
  const textarea = document.querySelector(".workshop-input textarea");
  textarea.focus();
  textarea.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
  );
});
await page.waitForFunction(() => document.querySelectorAll(".chat-attachment").length === 3, null, {
  timeout: 15000,
});
console.log(
  "chips after paste:",
  await page.$$eval(".chat-attachment-name", (els) => els.map((el) => el.textContent)),
);
await step("03-after-paste");

// 发送：正文 + 三个附件
await page.fill(".workshop-input textarea", "这是我上传的原作和封面参考，先看看是什么格式。");
await page.click(".workshop-input button.send-btn");
await page.waitForSelector(".chat-attachments.in-message", { timeout: 15000 });
await page.waitForTimeout(1200);
await step("04-message-attachments");

// 文件页：resources/ 真的落在剧目目录里
await page.goto(`${WEB}/#/play/attach-demo/stage?view=workshop&tab=files&workshop=1`, {
  waitUntil: "networkidle",
});
await page.waitForTimeout(1200);
const tree = await page.$$eval(".workshop-file-tree, .file-tree, aside", (els) =>
  els.map((el) => el.textContent?.trim().slice(0, 300)),
);
console.log("file tree:", JSON.stringify(tree).slice(0, 600));
await step("05-files-tab");

await browser.close();
console.log("done");
