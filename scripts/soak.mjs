#!/usr/bin/env node
/**
 * soak —— 过夜稳定性跑（P6 DoD）：脚本化玩家连打数小时，审计四件事——
 *   ① 无失忆：记忆装配非空（A 区素材清单在场）
 *   ② 无剧透：废弃分支的台词不进当前分支的事件缓冲
 *   ③ 分岔一致：跳转/分岔/重演后重放缓冲的 seq 从 1 连续
 *   ④ 内存缓涨：服务端 RSS 采样斜率不持续上扬
 *
 * **一个开关决定要不要花钱**：`--minutes` 就是授权。
 *   node scripts/soak.mjs                  → 预检，不连 WS、不调模型，秒退
 *   node scripts/soak.mjs --minutes=360    → 真跑（真调 LLM，要花钱）
 * 预检存在的理由：跑挂了排查几小时很贵，而「能不能跑」这件事本身几乎零成本可验。
 *
 * 前置：服务端已在 STAGE_PORT（默认 8787）运行，.env 指向廉价模型。
 * 产物：plays/<play>/soak/<时间戳>.md；控制台只留摘要与报告路径。
 * 退出码：0 通过 / 1 审查不通过 / 2 跑不起来（服务端不通、剧目不就绪、WS 连不上）。
 *
 * 零依赖：用 Node 22 内置的 WebSocket 与 fetch。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const EXIT_OK = 0;
const EXIT_AUDIT_FAILED = 1;
const EXIT_CANNOT_RUN = 2;

// ── 参数 ─────────────────────────────────────────────────────────────────

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [key, value] = a.replace(/^--/, "").split("=");
    return [key, value ?? ""];
  }),
);
const PLAY = args.get("play") || "demo";
const INTERVAL_S = Number(args.get("interval") || "45");
const minutesGiven = args.get("minutes") !== undefined;
const MINUTES = Number(args.get("minutes") || NaN);
const PORT = Number(process.env.STAGE_PORT ?? 8787);
const BASE = `http://127.0.0.1:${PORT}`;
const REPO = resolve(import.meta.dirname, "..");

if (minutesGiven && !(MINUTES > 0)) die("`--minutes` 要一个正数分钟数，例如 `--minutes=20`");
if (!(INTERVAL_S > 0)) die("`--interval` 要一个正数秒数");

// ── 预检（默认路径，零开销） ───────────────────────────────────────────────

const AUDITS = [
  ["① 无失忆", "每 10 轮核对记忆装配非空"],
  ["② 无剧透", "废弃分支的台词不进当前事件缓冲"],
  ["③ 分岔一致", "跳转/分岔/重演后重放的 seq 从 1 连续"],
  ["④ 内存缓涨", "服务端 RSS 斜率不持续上扬"],
];
const 齐缺 = (b) => (b ? "齐" : "缺（不阻塞演出）");

/**
 * 只答两个问题：服务端在不在、这个剧目开不开得了演。
 * 不连 WS——连上就会被 autostart 开轮，那已经是在花钱了。
 */
async function preflight() {
  const health = await getJson("/api/health");
  if (!health) die(`服务端不可达 ${BASE}/api/health —— 先 pnpm --filter @aivn/server start`);

  const play = await getJson(`/api/plays/${PLAY}`);
  if (!play) die(`读不到剧目 ${PLAY}（${BASE}/api/plays/${PLAY}）`);
  const { ready, characterSprites, background, hasSession } = play.readiness ?? {};

  console.log(`soak 预检 · ${PLAY}《${play.play?.title ?? PLAY}》 · 不连 WS、不调模型`);
  console.log(
    `  服务端  ${BASE}  在跑 ${health.uptimeSec}s · RSS ${health.rssMb}MB · 活剧目 ${health.plays}`,
  );
  console.log(`  模型    ${envValue("STAGE_MODEL_ID") || "(读 .env)"}  ← 这一栏决定这趟要花多少钱`);
  console.log(`  前提    ${play.premise?.trim() ? `${play.premise.trim().length} 字` : "缺，开不了演"}`);
  console.log(
    `  角色    ${(play.play?.characters ?? []).length} 位 · 立绘${齐缺(characterSprites)} · 背景${齐缺(background)}`,
  );
  console.log(`  周目    ${hasSession ? "有存档可接着演" : "无存档（会开新周目）"}`);

  if (!ready) die(`剧目 ${PLAY} 没过就绪门：缺 memory/always/premise.md（世界观前提的唯一真相源）`);

  console.log("\n可以跑。加 `--minutes=<分钟数>` 才会真跑（真调 LLM、要花钱），届时审计：");
  for (const [name, what] of AUDITS) console.log(`  ${name}  ${what}`);
  console.log("\n例：node scripts/soak.mjs --minutes=20 --interval=45");
  process.exit(EXIT_OK);
}

// ── 真跑 ─────────────────────────────────────────────────────────────────

const STOPS = new Set(["choice", "free", "pause"]);
const EDITABLE = new Set(["say", "narrate", "thought"]);

const samples = [];
const failures = [];
const startedAt = Date.now();
let beats = 0;
let actions = 0;
let directs = 0;
let rebases = 0;
let busyRejects = 0;
let lastBeatAt = startedAt;
/** 审计②的探针：当前分支事件缓冲里出现过的全部台词，rebase 时整段换掉。 */
let bufferText = "";
let replaySeq = 0;
let mismatches = 0;
let memoryCards = -1;
let hello = null;
let ws;
let tick;

/** 建连开打。只有给了 `--minutes` 才会走到这里——预检绝不建 WS，连上就被 autostart 开轮。 */
function run() {
  ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?play=${PLAY}`);
  ws.addEventListener("open", () => {
    // 不发 start：ClientMessage.start 已删，新档是空树，autostart 自己开轮
    console.log(`ws 已连接 ws://127.0.0.1:${PORT}/ws?play=${PLAY}`);
  });
  ws.addEventListener("error", () => finish("ws 连不上", EXIT_CANNOT_RUN));
  ws.addEventListener("close", (ev) => {
    if (ev.code !== 1000) finish(`ws 异常断开 code=${ev.code}`, EXIT_CANNOT_RUN);
  });
  ws.addEventListener("message", onMessage);
  tick = setInterval(() => {
    if ((Date.now() - startedAt) / 60000 >= MINUTES) finish("到时");
    // 心跳：长时间没有新轮说明卡住了（模型出错或停止点没人解），主动续一轮
    else if (beats > 0 && Date.now() - lastBeatAt > INTERVAL_S * 1000 * 3) send({ type: "continue" });
  }, INTERVAL_S * 1000);
}

function onMessage(ev) {
  let msg;
  try {
    msg = JSON.parse(String(ev.data));
  } catch (err) {
    return fail("协议", `收到非 JSON 帧：${err.message}`);
  }
  switch (msg.type) {
    case "hello":
      hello = msg;
      break;
    case "events":
      for (const { seq, event } of msg.events ?? []) {
        replaySeq = Math.max(replaySeq, seq);
        if (typeof event?.delta === "string") bufferText += event.delta;
      }
      break;
    case "rebase": {
      rebases += 1;
      // ③ 重放缓冲的 seq 必须从 1 连续到末尾
      const seqs = (msg.events ?? []).map((e) => e.seq);
      if (!seqs.every((seq, i) => seq === i + 1)) mismatches += 1;
      replaySeq = seqs.at(-1) ?? 0;
      bufferText = (msg.events ?? [])
        .map(({ event }) => (typeof event.delta === "string" ? event.delta : ""))
        .join("");
      console.log(
        `rebase #${rebases} epoch=${msg.epoch} 事件=${seqs.length} ${msg.resuming ? "（重演）" : ""}` +
          ` note=${msg.note ?? msg.reason ?? "-"}`,
      );
      break;
    }
    case "beat_end":
      onBeatEnd(msg);
      break;
    case "error":
      // 演出进行中 = 空闲守卫按预期拒绝了抢跑（导演动词连发时常见），不是缺陷
      if (msg.message.includes("演出进行中")) busyRejects += 1;
      else fail("server", msg.message);
      break;
    default:
      break;
  }
}

function onBeatEnd(msg) {
  beats += 1;
  lastBeatAt = Date.now();
  const stop = msg.stop ?? null;
  sampleRss();
  console.log(
    `第 ${beats} 轮 reason=${msg.reason} stop=${stop?.stopType ?? "-"} ` +
      `缓冲末=${replaySeq} 重放异常=${mismatches} rss=${lastRss()}MB`,
  );

  if (beats % 10 === 0) {
    auditMemory();
    auditSpoiler();
  }
  if (stop && STOPS.has(stop.stopType)) {
    actions += 1;
    send(pickAction(stop));
  } else if (beats % 5 === 0) {
    // 本轮自然写完（no_stop）没有停止点，等价于一个可以插手的位置
    actions += 1;
    send({ type: "continue" });
  }
  if (beats % 5 === 0) void directOnce();
}

/** 脚本化玩家：轮换表态，覆盖 choice / free / continue / 插一句四条通路。 */
function pickAction(stop) {
  const round = actions % 4;
  if (stop.stopType === "choice" && stop.options?.length) {
    return { type: "player_choice", optionIndex: round % stop.options.length };
  }
  if (stop.stopType === "free") {
    return { type: "player_free", text: "（我静静看着她，等她先开口。）" };
  }
  if (round === 3) {
    // 导演指示走「插一句」+ `OOC：` 前缀，协议里没有 ooc 消息类型
    return { type: "prompt", text: "OOC：让这一轮台词更短、节奏快一点。" };
  }
  return { type: "continue" };
}

/**
 * 四个导演动词轮换着打一遍：跳转 / 改台词 / 重演这一轮 / 分岔。
 * 锚点一律取轮首——落在轮中会把那一轮的后半段整段截掉（P6）。
 */
async function directOnce() {
  try {
    const view = await getJson(`/api/plays/${PLAY}/lineage`);
    if (!view) return;
    const cards = beatCards(view);
    const lines = view.nodes.filter((n) => n.onPath && EDITABLE.has(n.kind) && n.text);
    if (cards.length < 2 || lines.length < 2) return;

    switch (directs++ % 4) {
      case 0:
        return send({ type: "jump", nodeId: cards.at(-1).anchor });
      case 1:
        return send({ type: "edit", nodeId: lines[1].id, newText: `（第 ${directs} 次被导演改写的台词。）` });
      case 2:
        return send({ type: "fork", nodeId: cards.at(-2).anchor, resume: true });
      default:
        return send({ type: "fork", nodeId: cards.at(-1).endId });
    }
  } catch (err) {
    fail("导演动词", err.message);
  }
}

/** 把谱系当前路径切成一轮一张卡，锚点 = 轮首事件 id（与前端 buildBeats 同一套切法）。 */
function beatCards(view) {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const cards = [];
  let current = null;
  for (const id of view.pathIds ?? []) {
    const node = byId.get(id);
    // preload/fork 是结构标记不是剧情，不当轮首
    if (!node || node.kind === "preload" || node.kind === "fork") continue;
    if (!current) cards.push((current = { anchor: node.id, endId: node.id }));
    current.endId = node.id;
    if (node.kind === "beat_end") current = null;
  }
  return cards;
}

/** ① 无失忆：记忆层装配出来的东西不能是空的。 */
async function auditMemory() {
  const files = await getJson(`/api/plays/${PLAY}/files`);
  if (!files) return;
  memoryCards = files.filter((f) => String(f.path ?? "").startsWith("memory/")).length;
  if (memoryCards === 0) fail("失忆", `第 ${beats} 轮记忆层为空（A 区没有素材清单）`);
}

/**
 * ② 无剧透：废弃分支的行文本不得出现在当前分支的事件缓冲里。
 * 缓冲由谱系当前路径重放而来，缓冲里出现旁支台词即意味着上下文也漏了。
 */
async function auditSpoiler() {
  const view = await getJson(`/api/plays/${PLAY}/lineage`);
  if (!view) return;
  const onPath = new Set(view.pathIds ?? []);
  const leaked = view.nodes
    .filter((n) => !onPath.has(n.id) && typeof n.text === "string" && n.text.length >= 8)
    .map((n) => n.text)
    .filter((text) => bufferText.includes(text));
  if (leaked.length > 0) fail("剧透", `第 ${beats} 轮缓冲含 ${leaked.length} 句废弃分支台词`);
}

/** 采样**服务端** RSS（不是本脚本进程）：内存审计要看跑 LLM 与状态机的那一侧。 */
async function sampleRss() {
  const health = await getJson("/api/health");
  if (!health) return fail("内存", "健康检查不可达");
  const rss = Number(health.rssMb) || 0;
  const last = samples.at(-1);
  samples.push({ rss, delta: last ? rss - last.rss : 0 });
}

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function lastRss() {
  return samples.length ? Math.round(samples.at(-1).rss) : 0;
}

function finish(reason, code) {
  clearInterval(tick);
  if (ws?.readyState === WebSocket.OPEN) ws.close(1000, "soak done");

  const minutes = (Date.now() - startedAt) / 60000;
  const trend = slope(samples);
  const verdicts = [
    ["① 无失忆", memoryCards === 0 ? "不通过：记忆层为空" : `通过 · 记忆卡 ${memoryCards} 张`],
    [
      "② 无剧透",
      failures.some((f) => f.startsWith("[剧透]")) ? "不通过：有旁支台词泄漏" : "通过 · 缓冲无旁支台词",
    ],
    [
      "③ 分岔一致",
      mismatches === 0 ? `通过 · ${rebases} 次重放 seq 连续` : `不通过：${mismatches} 次重放不连续`,
    ],
    ["④ 内存缓涨", trend > 2 ? `不通过：斜率 +${trend.toFixed(2)} MB/轮` : `通过 · 斜率 ${trend.toFixed(2)} MB/轮`],
  ];
  const passed = failures.length === 0 && trend <= 2 && mismatches === 0;
  const report = writeReport({ reason, minutes, trend, verdicts, failures, passed });

  console.log(`\n──────── soak ${passed ? "通过" : "不通过"} ────────`);
  console.log(`结束原因 ${reason} · 用时 ${minutes.toFixed(1)}min · 报告 ${report}`);
  console.log(
    `轮数 ${beats} · 玩家动作 ${actions} · 导演动词 ${directs} · rebase ${rebases} · ` +
      `缓冲末 seq ${replaySeq} · 空闲守卫拒绝 ${busyRejects} · 服务端 RSS ${lastRss()}MB`,
  );
  for (const [name, verdict] of verdicts) console.log(`  ${name}  ${verdict}`);
  if (failures.length) console.log(`失败明细:\n${failures.join("\n")}`);

  process.exit(code ?? (passed ? EXIT_OK : EXIT_AUDIT_FAILED));
}

function fail(where, detail) {
  failures.push(`[${where}] ${detail}`);
  console.error(`✗ ${where}: ${detail}`);
}

/** 最小二乘斜率（MB/轮）。 */
function slope(points) {
  if (points.length < 2) return 0;
  const n = points.length;
  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.rss);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0);
  const den = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  return den === 0 ? 0 : num / den;
}

// ── 报告落盘 ──────────────────────────────────────────────────────────────

/** 报告进 plays/<play>/soak/<时间戳>.md：控制台只留摘要，长报告留档、便于回看。 */
function writeReport({ reason, minutes, trend, verdicts, failures, passed }) {
  const dir = join(REPO, "plays", PLAY, "soak");
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const file = join(dir, `${stamp(now)}.md`);
  writeFileSync(
    file,
    [
      `# soak 报告 · ${PLAY} · ${now.toLocaleString("zh-CN")}`,
      "",
      `- 参数：\`--minutes=${MINUTES} --interval=${INTERVAL_S}\``,
      `- 结束原因：${reason} · 用时 ${minutes.toFixed(1)}min · 结论 **${passed ? "通过" : "不通过"}**`,
      `- 轮数 ${beats} · 玩家动作 ${actions} · 导演动词 ${directs} · rebase ${rebases} · 缓冲末 seq ${replaySeq}`,
      `- 空闲守卫拒绝 ${busyRejects} · 服务端 RSS 末值 ${lastRss()}MB · 斜率 ${trend.toFixed(3)} MB/轮`,
      `- hello：角色 ${hello?.cast?.length ?? 0} · 语音 ${hello?.voice ?? false} · 已生成资产 ${hello?.assets?.length ?? 0}`,
      "",
      "## 四道审计",
      "",
      "| 审计 | 结论 |",
      "| --- | --- |",
      ...verdicts.map(([name, verdict]) => `| ${name} | ${verdict} |`),
      "",
      "## 失败明细",
      "",
      failures.length ? failures.map((f) => `- ${f}`).join("\n") : "无",
      "",
    ].join("\n"),
    "utf8",
  );
  return file;
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ── 杂项 ─────────────────────────────────────────────────────────────────

async function getJson(path) {
  try {
    const res = await fetch(BASE + path);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** .env 只读取值：预检要告诉用户这趟烧哪个模型。 */
function envValue(key) {
  if (process.env[key]) return process.env[key];
  try {
    const line = readFileSync(join(REPO, ".env"), "utf8").split("\n").find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

function die(message, code = EXIT_CANNOT_RUN) {
  console.error(`soak：${message}`);
  process.exit(code);
}

process.on("SIGINT", () => finish("收到 SIGINT"));
process.on("SIGTERM", () => finish("收到 SIGTERM"));

if (minutesGiven) run();
else await preflight();
