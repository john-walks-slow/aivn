/**
 * 造一棵 mock 谱系历史（给「路线」视图与切拍逻辑看形状用，不烧真模型）。
 * 直接用 core 的 LineageTree 拼事件树，落成服务端能 load 的 session.json。
 * 用法：node scripts/mockLineage.mjs [playId] [deep|flat]
 */
import { mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LineageTree } from "../packages/core/dist/lineage/model.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const playId = process.argv[2] ?? "mock-deep";
const pattern = process.argv[3] ?? "deep";
const dir = join(root, "plays", playId);

const KOHARU = "koharu";
const tree = new LineageTree();
let seq = 0;

/** 在当前叶尖追加一个事件（叶尖由 append 自动推进）。 */
const add = (kind, text, extra = {}) => tree.append(kind, { text, payload: { seq: seq++, ...extra } });

/** 一拍：场景 + 几句台词 + 停止点 + beat_end。 */
function beat({ bg, lines, stop, marker }) {
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
}

if (pattern === "deep") {
  // 主线 A → B → C
  beat({ bg: "bg_classroom_sunset", stop: "choice", lines: ["呼——好险好险！抱歉抱歉，被教导主任抓去搬旧体操服了。", "你、你不许笑！这是第几次了啊！"] });
  const afterA = tree.leafId;
  const afterB = beat({ bg: "bg_classroom_sunset", stop: "pause", lines: ["呜哇，一见面就用这种质问的语气吗？好严格……", "明明人家也是为了班级着想才跑慢的。"] });
  beat({ bg: "bg_corridor", stop: "pause", lines: ["她抱起一叠作业，脚步在走廊里敲出节拍。", "你要帮她，还是假装没看见？"] });

  // 分岔 1：在 A 之后岔出去 → B→C 整条成为浅层废弃分支
  tree.forkAt(afterA);
  beat({ bg: "bg_rooftop", stop: "free", lines: ["你追上天台。风把她的裙摆吹得鼓起来。", "她没回头：跟上来干什么？"] });

  // 分岔 2：主线上再分岔一次（带重写标注）
  tree.forkAt(afterB);
  beat({ bg: "bg_stairwell", stop: "choice", lines: ["她在楼梯转角停下，鞋尖点了点地面。"], marker: "让小春先软下来一点" });
  beat({ bg: "bg_rooftop", stop: "pause", lines: ["你们一起上了天台。", "——所以，你今天到底想说什么？"] });

  // 分岔 3：整棵树换个起点，之前的全部成为深层废弃分支
  tree.forkAt(afterA);
  beat({ bg: "bg_courtyard", stop: "pause", lines: ["放学铃。你在校门口回头，她正跑着追上来。", "「明天——也一起走吗？」"] });
} else {
  beat({ bg: "bg_classroom_sunset", stop: "choice", lines: ["呼——好险好险！抱歉抱歉，被教导主任抓去搬旧体操服了。", "你、你不许笑！"] });
  const afterA = tree.leafId;
  const names = ["道歉线", "嘴硬线", "沉默线"];
  names.forEach((name, i) => {
    tree.forkAt(afterA);
    beat({
      bg: ["bg_corridor", "bg_stairwell", "bg_rooftop"][i],
      stop: "pause",
      lines: [`【${name}】她把课本卷成筒，轻轻敲了下你的头。`, "这次真的只说一遍。"],
    });
  });
}

const events = tree.export().events.map((event, i) => ({ ...event, createdAt: 1_700_000_000_000 + i * 1000 }));
await mkdir(dir, { recursive: true });
await copyFile(join(root, "plays", "demo", "play.json"), join(dir, "play.json"));
await writeFile(
  join(dir, "session.json"),
  JSON.stringify(
    {
      version: 1,
      lineage: { ...tree.export(), events },
      engine: { flags: {}, sceneDetails: {}, activeThreads: [] },
      scene: "黄昏的教室",
      runtime: { events: [], beatNo: 0, epoch: 0 },
      savedAt: Date.now(),
    },
    null,
    2,
  ),
);
await rm(join(dir, "lineage.jsonl"), { force: true });
const counts = new Map();
for (const e of events) if (e.parentId) counts.set(e.parentId, (counts.get(e.parentId) ?? 0) + 1);
console.log(
  `${playId}（${pattern}）：${events.length} 事件，leaf=${tree.leafId}，分叉点 ${[...counts]
    .filter(([, n]) => n > 1)
    .map(([id, n]) => `${id.slice(0, 6)}(子${n})`)
    .join(" ") || "无"}`,
);
