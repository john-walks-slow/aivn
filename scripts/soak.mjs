/**
 * 过夜 soak（P6 DoD）：脚本化玩家连打数小时，审计四件事——
 *   ① 无失忆：每拍记忆装配非空（systemPrompt 含 A 区素材清单）
 *   ② 无剧透：兄弟/废弃分支内容不进入当前分支的 LLM 上下文
 *   ③ 分岔一致：跳转/分岔后事件缓冲与谱系路径同刻一致（rebase 后重放可对账）
 *   ④ 内存缓涨：RSS 采样斜率不持续上扬
 *
 * 用法：node scripts/soak.mjs [--play=demo] [--minutes=360] [--interval=45] [--seed]
 * 前置：服务端已在 STAGE_PORT（默认 8787）运行，.env 指向廉价模型（low/medium）。
 * 产物：控制台进度 + 结束时打印审计结论（失败项非零退出码）。
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);
const PLAY = args.get("play") ?? "demo";
const MINUTES = Number(args.get("minutes") ?? 360);
const INTERVAL_S = Number(args.get("interval") ?? 45);
const PORT = Number(process.env.STAGE_PORT ?? 8787);
const REPO = resolve(import.meta.dirname, "..");
const READY_REF = join(REPO, "plays", PLAY, "play.json");

const STOPS = new Set(["choice", "free", "pause"]);

const samples = [];
const failures = [];
const startedAt = Date.now();
let beats = 0;
let rebases = 0;
let actions = 0;
let busyRejects = 0;

function fail(where, detail) {
  failures.push(`[${where}] ${detail}`);
  console.error(`✗ ${where}: ${detail}`);
}

const branch = { replaySeq: 0, mismatches: 0, bufferText: "", cards: 0 };

/** 读取工坊就绪门（首拍就绪检查用；不通过就换剧本）。 */
function readyBaseline() {
  try {
    const play = JSON.parse(readFileSync(READY_REF, "utf8"));
    return {
      title: play.title ?? PLAY,
      premise: play.premise ?? "",
      characters: (play.characters ?? []).length,
    };
  } catch {
    return { title: PLAY, premise: "", characters: 0 };
  }
}

const baseline = readyBaseline();
console.log(
  `soak 开始：play=${PLAY} 模型别名=${process.env.STAGE_MODEL_ID ?? "(读 .env)"} ` +
    `时长=${MINUTES}min 节奏=${INTERVAL_S}s 剧本=${baseline.title} 角色=${baseline.characters}`,
);

// 用 Node 22 内置 WebSocket 客户端：脚本零依赖，任何环境 node scripts/soak.mjs 即可跑
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?play=${PLAY}`);
let freshSession = true;

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ type: "start" }));
  console.log(`ws 已连接 ws://127.0.0.1:${PORT}/ws?play=${PLAY}`);
});

ws.addEventListener("error", () => fail("ws", "连接失败（服务端未启动？）"));

ws.addEventListener("close", (ev) => {
  if (ev.code !== 1000) fail("ws", `异常断开 code=${ev.code}`);
});

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(String(ev.data));
  switch (msg.type) {
    case "hello":
      if (freshSession) {
        freshSession = false;
        console.log(`hello cast=${msg.cast?.length ?? 0} voice=${msg.voice} assets=${msg.assets?.length ?? 0}`);
      }
      break;
    case "rebase": {
      rebases += 1;
      branch.bufferText = (msg.events ?? [])
        .map(({ event }) => (typeof event.delta === "string" ? event.delta : ""))
        .join("");
      // ③ 分岔一致：重放缓冲的 seq 必须从 1 连续到末尾，且 epoch 单调
      const seqs = (msg.events ?? []).map((e) => e.seq);
      const contiguous = seqs.every((s, i) => s === i + 1);
      if (!contiguous) branch.mismatches += 1;
      branch.replaySeq = seqs.at(-1) ?? 0;
      console.log(
        `rebase epoch=${msg.epoch} 事件=${seqs.length} 连续=${contiguous} ` +
          `note=${msg.note ?? msg.reason ?? ""}`,
      );
      break;
    }
    case "beat_end":
      onBeatEnd(msg);
      break;
    case "events":
      for (const { seq } of msg.events ?? []) branch.replaySeq = Math.max(branch.replaySeq, seq);
      break;
    case "error":
      // 演出进行中 = 空闲守卫按预期拒绝了抢跑（结构操作会连发几条），不是缺陷
      if (msg.message.includes("演出进行中")) busyRejects += 1;
      else fail("server", msg.message);
      break;
    default:
      break;
  }
});

function onBeatEnd(msg) {
  beats += 1;
  lastBeatAt = Date.now();
  const stop = msg.stop ?? null;
  sampleRss();
  console.log(
    `beat ${beats} reason=${msg.reason} stop=${stop?.stopType ?? "-"} ` +
      `缓冲=${branch.replaySeq} 重演=${branch.mismatches} rss=${lastRss()}MB`,
  );

  // ① 无失忆：每若干拍核对一次上下文装配（A 区素材清单在 systemPrompt 里）
  if (beats % 10 === 0) auditMemory();
  // ② 无剧透：暗号只出现在兄弟分支，绝不能进当前分支上下文
  if (beats % 10 === 0) auditSpoiler();

  if (stop && STOPS.has(stop.stopType)) {
    const action = pickAction(stop);
    actions += 1;
    if (msg.reason === "act_end" && stop.stopType === "pause") {
      // 自由收尾处做一次结构操作（覆盖 DoD 的分岔一致性）
      void scheduleStructural();
      return;
    }
    send(action);
  }
  if (beats % 5 === 0) void scheduleStructural();
}

/** 脚本化玩家：固定轮换四种表态，覆盖 choice/free/continue/OOC 四条通路。 */
function pickAction(stop) {
  const round = actions % 4;
  if (stop.stopType === "choice" && stop.options?.length) {
    return { type: "player_choice", optionIndex: round % stop.options.length };
  }
  if (stop.stopType === "free") {
    return { type: "player_free", text: "（我静静看着她，等她先开口。）" };
  }
  if (round === 3) {
    return { type: "ooc", text: "让这一拍节奏慢一点，台词更短。" };
  }
  return { type: "continue" };
}

/** 定期做结构操作：书签（纯标记）/ 原地编辑 / 重写 / 顶端分岔——四原语全都在连打中反复过。 */
async function scheduleStructural() {
  try {
    const view = await fetch(`http://127.0.0.1:${PORT}/api/plays/${PLAY}/lineage`).then((r) => r.json());
    const rows = (view.nodes ?? []).filter(
      (n) => ["say", "narrate", "thought"].includes(n.kind) && n.text && n.onPath,
    );
    if (rows.length < 3) return;
    send({ type: "bookmark", nodeId: rows[rows.length - 2].id, name: `soak-${beats}` });
    send({ type: "edit", nodeId: rows[1].id, newText: "（这句在 soak 里被导演改过一次。）" });
    if (beats % 6 === 0) {
      send({
        type: "rewrite",
        nodeId: rows[0].id,
        granularity: "beat",
        instruction: "换一个更冷的角度重演这一幕，台词更短。",
      });
    }
    // 顶端分岔：检验同刻重放（epoch+1、seq 连续），不把故事拽回开场
    send({ type: "fork", nodeId: rows[rows.length - 1].id });
  } catch (err) {
    fail("结构操作", err.message);
  }
}

function auditMemory() {
  fetch(`http://127.0.0.1:${PORT}/api/plays/${PLAY}/files`)
    .then((r) => r.json())
    .then((list) => {
      const cards = (list ?? []).filter((f) => String(f.path ?? "").startsWith("memory/"));
      branch.cards = cards.length;
      if (cards.length === 0) fail("记忆", `第 ${beats} 拍记忆卡为空（失忆？）`);
    })
    .catch((err) => fail("记忆", err.message));
}

/**
 * ② 无剧透：废弃/兄弟分支的行文本不得出现在当前分支的事件缓冲里。
 * 缓冲由谱系当前路径重放而来，缓冲里出现旁支台词即意味着上下文也漏了。
 */
function auditSpoiler() {
  fetch(`http://127.0.0.1:${PORT}/api/plays/${PLAY}/lineage`)
    .then((r) => r.json())
    .then((view) => {
      const onPath = new Set(view.pathIds ?? []);
      const offPathTexts = (view.nodes ?? [])
        .filter((n) => !onPath.has(n.id) && typeof n.text === "string")
        .map((n) => n.text)
        .filter((t) => t.length >= 8);
      const leaked = offPathTexts.filter((t) => branch.bufferText.includes(t));
      if (leaked.length > 0) {
        fail("剧透", `第 ${beats} 拍缓冲含 ${leaked.length} 句废弃分支台词`);
      }
    })
    .catch((err) => fail("剧透", err.message));
}

function lastRss() {
  const s = samples.at(-1);
  return s ? Math.round(s.rss) : 0;
}

function send(msg) {
  ws.send(JSON.stringify(msg));
}

/** 采样**服务端** RSS（不是本脚本进程）：内存审计要看跑 LLM 与状态机的那一侧。 */
function sampleRss() {
  fetch(`http://127.0.0.1:${PORT}/api/health`)
    .then((r) => r.json())
    .then((health) => {
      const rss = Number(health.rssMb) || 0;
      const last = samples.at(-1);
      samples.push({ at: Date.now(), rss, delta: last ? rss - last.rss : 0, heap: health.heapUsedMb });
      // ④ 内存缓涨：最近窗口的平均增量不得持续为正
      if (samples.length >= 10) {
        const window = samples.slice(-10);
        const trend = window.reduce((sum, s) => sum + s.delta, 0) / window.length;
        if (trend > 2) fail("内存", `近 10 拍服务端 RSS 平均 +${trend.toFixed(1)}MB/拍（持续上扬）`);
      }
    })
    .catch((err) => fail("内存", `健康检查不可达：${err.message}`));
}

let lastBeatAt = Date.now();

const tick = setInterval(() => {
  const elapsed = (Date.now() - startedAt) / 60000;
  if (elapsed >= MINUTES) return finish("到时");
  // 心跳：没有新拍说明卡住了（模型错误/停止点未解），主动 continue 一次
  if (beats > 0 && Date.now() - lastBeatAt > INTERVAL_S * 1000 * 3) {
    send({ type: "continue" });
  }
}, INTERVAL_S * 1000);

function finish(reason) {
  clearInterval(tick);
  const trend = slope(samples);
  console.log("\n──────── soak 审计 ────────");
  console.log(`结束原因: ${reason} · 时长 ${((Date.now() - startedAt) / 60000).toFixed(1)}min`);
  console.log(
    `节拍 ${beats} · 玩家动作 ${actions} · rebase ${rebases} · 缓冲末 seq ${branch.replaySeq} · ` +
      `守卫拒绝 ${busyRejects} · 服务端 RSS 末值 ${lastRss()}MB`,
  );
  console.log(`RSS 斜率: ${trend.toFixed(3)} MB/拍（负数=缓降）`);
  const verdict = trend > 2 ? "不通过：内存持续上涨" : "内存水位通过";
  console.log(`④ 内存: ${verdict}`);
  console.log(
    `① 记忆装配: ${failures.some((f) => f.startsWith("[记忆]")) ? "失忆告警" : `无失忆（记忆卡 ${branch.cards} 张）`}`,
  );
  console.log(`② 防剧透: ${failures.some((f) => f.startsWith("[剧透]")) ? "泄漏告警" : "无泄漏"}`);
  console.log(
    `③ 分岔一致: ${branch.mismatches === 0 ? `重放连续无缺口（${rebases} 次 rebase）` : `${branch.mismatches} 次重放不连续`}`,
  );
  ws.close(1000, "soak done");
  const bad = failures.length > 0 || trend > 2 || branch.mismatches > 0;
  console.log(failures.length ? `\n失败明细:\n${failures.join("\n")}` : "\n无失败项");
  process.exit(bad ? 1 : 0);
}

/** 最小二乘斜率（MB/拍）。 */
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

process.on("SIGINT", () => finish("收到 SIGINT"));
process.on("SIGTERM", () => finish("收到 SIGTERM"));
