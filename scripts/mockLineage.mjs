/**
 * 造若干棵 mock 谱系存档（给「周目」列表、「路线」视图与切拍逻辑看形状用，不烧真模型）。
 * 直接用 core 的 LineageTree 拼事件树，落成服务端能 load 的 saves/<saveId>/session.json。
 * 用法：node scripts/mockLineage.mjs [playId] [deep|flat] [周目数]
 */
import { mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LineageTree } from "../packages/core/dist/lineage/model.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const playId = process.argv[2] ?? "mock-deep";
const pattern = process.argv[3] ?? "deep";
const saveCount = Math.max(1, Number(process.argv[4] ?? 2) || 2);
const dir = join(root, "plays", playId);

const KOHARU = "koharu";
const PREVIEW_KINDS = new Set(["say", "narrate", "thought"]); // 与服务端 store.ts 保持一致

/** 造一棵树。 */
function buildTree(shape) {
  const tree = new LineageTree();
  let seq = 0;

  /** 在当前叶尖追加一个事件（叶尖由 append 自动推进）。 */
  const add = (kind, text, extra = {}) => tree.append(kind, { text, payload: { seq: seq++, ...extra } });

  /** 一拍：场景 + 几句台词 + 停止点 + beat_end。 */
  const beat = ({ bg, lines, stop, marker }) => {
    add("scene", "", { attrs: { bg, bgm: "bgm_sunset" } });
    lines.forEach((line, i) => {
      add("actor", "", { attrs: { id: KOHARU, pos: i === 0 ? "center" : "left" } });
      add("say", line, { attrs: { id: KOHARU, mood: i === 0 ? "smile" : "normal" } });
    });
    if (marker) add("rewrite", "", { granularity: "beat", instruction: marker });
    if (stop === "choice") {
      add("stop", "", {
        stopType: "choice",
        options: [
          { text: "老实道歉", next: "道歉线" },
          { text: "嘴硬顶回去", next: "嘴硬线" },
        ],
      });
    } else if (stop === "free") {
      add("stop", "", { stopType: "free", placeholder: "你想怎么做？" });
    } else {
      add("stop", "", { stopType: "pause" });
    }
    add("beat_end", "", { reason: stop ?? "pause" });
    return tree.leafId;
  };

  if (shape === "deep") {
    // 主线 A → B → C
    beat({ bg: "bg_classroom_sunset", stop: "choice", lines: ["呼——好险好险！抱歉抱歉，被教导主任抓去搬旧体操服了。", "你、你不许笑！这是第几次了啊！"] });
    const afterA = tree.leafId;
    const afterB = beat({ bg: "bg_classroom_sunset", stop: "pause", lines: ["呜哇，一见面就用这种质问的语气吗？好严格……", "明明人家也是为了班级着想才跑慢的。"] });
    beat({ bg: "bg_school_gate_sakura", stop: "pause", lines: ["她抱起一叠作业，脚步在走廊里敲出节拍。", "你要帮她，还是假装没看见？"] });

    // 分岔 1：在 A 之后岔出去 → B→C 整条成为浅层废弃分支
    tree.forkAt(afterA);
    beat({ bg: "bg_rooftop_breeze", stop: "free", lines: ["你追上天台。风把她的裙摆吹得鼓起来。", "她没回头：跟上来干什么？"] });

    // 分岔 2：主线上再分岔一次（带重写标注）
    tree.forkAt(afterB);
    beat({ bg: "bg_library_sunlight", stop: "choice", lines: ["她在楼梯转角停下，鞋尖点了点地面。"], marker: "让小春先软下来一点" });
    beat({ bg: "bg_rooftop_breeze", stop: "pause", lines: ["你们一起上了天台。", "——所以，你今天到底想说什么？"] });

    // 分岔 3：整棵树换个起点，之前的全部成为深层废弃分支
    tree.forkAt(afterA);
    beat({ bg: "bg_heroine_bedroom", stop: "pause", lines: ["放学铃。你在校门口回头，她正跑着追上来。", "「明天——也一起走吗？」"] });
  } else {
    beat({ bg: "bg_classroom_sunset", stop: "choice", lines: ["呼——好险好险！抱歉抱歉，被教导主任抓去搬旧体操服了。", "你、你不许笑！"] });
    const afterA = tree.leafId;
    ["道歉线", "嘴硬线", "沉默线"].forEach((name, i) => {
      tree.forkAt(afterA);
      beat({
        bg: ["bg_school_gate_sakura", "bg_library_sunlight", "bg_rooftop_breeze"][i],
        stop: "pause",
        lines: [`【${name}】她把课本卷成筒，轻轻敲了下你的头。`, "这次真的只说一遍。"],
      });
    });
  }
  return tree;
}

/** 档元信息：拍数与最后一句与服务端 touchMeta 同一算法，周目列表直接读它。 */
function metaOf(tree, id, name, now) {
  const chain = tree.chainEvents(tree.leafId);
  const beats = chain.filter((e) => e.kind === "beat_end").length;
  const last = [...chain].reverse().find((e) => PREVIEW_KINDS.has(e.kind) && e.text);
  return { id, name, createdAt: now, updatedAt: now, beats, preview: (last?.text ?? "").slice(0, 60) };
}

await rm(join(dir, "saves"), { recursive: true, force: true });
await rm(join(dir, "active.json"), { force: true });
await mkdir(dir, { recursive: true });
await copyFile(join(root, "plays", "demo", "play.json"), join(dir, "play.json"));

const created = [];
for (let i = 0; i < saveCount; i += 1) {
  // 各档交替两种树形：切档时舞台上的最后一句必须不同，才看得出换没换树
  const shape = i % 2 === 0 ? pattern : pattern === "deep" ? "flat" : "deep";
  const tree = buildTree(shape);
  const events = tree.export().events.map((event, j) => ({ ...event, createdAt: 1_700_000_000_000 + j * 1000 }));
  const id = `s${(1_700_000_000_000 + i * 86_400_000).toString(36)}`;
  const name = `第 ${i + 1} 周目`;
  const now = 1_757_000_000_000 + i * 86_400_000;
  const saveDir = join(dir, "saves", id);
  await mkdir(saveDir, { recursive: true });
  await writeFile(join(saveDir, "meta.json"), JSON.stringify(metaOf(tree, id, name, now), null, 2));
  await writeFile(
    join(saveDir, "session.json"),
    JSON.stringify(
      {
        version: 1,
        lineage: { ...tree.export(), events },
        engine: { flags: {}, sceneDetails: {}, activeThreads: [] },
        scene: "黄昏的教室",
        runtime: { events: [], beatNo: 0, epoch: 0 },
        savedAt: now,
      },
      null,
      2,
    ),
  );
  await rm(join(saveDir, "lineage.jsonl"), { force: true });
  created.push({ id, name, events: events.length, leaf: tree.leafId });
}

await writeFile(join(dir, "active.json"), JSON.stringify({ saveId: created[0].id }, null, 2));

const counts = new Map();
for (const e of buildTree(pattern).export().events) {
  if (e.parentId) counts.set(e.parentId, (counts.get(e.parentId) ?? 0) + 1);
}
console.log(
  `${playId}（${pattern}）：${saveCount} 个周目，当前档 ${created[0].name}/${created[0].id}；` +
    `首档 ${created[0].events} 事件，leaf=${created[0].leaf.slice(0, 6)}，分叉点 ${[...counts]
      .filter(([, n]) => n > 1)
      .map(([id, n]) => `${id.slice(0, 6)}(子${n})`)
      .join(" ") || "无"}`,
);

