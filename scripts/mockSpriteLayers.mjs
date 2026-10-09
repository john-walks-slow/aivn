/**
 * 造一个专测**换层转场 × 立绘层叠**的 mock 存档（不烧模型、不触发真演出）。
 *
 * 为什么需要它：261008 那个 bug（背景双层栈的 z-index 逃出自己那一层、压住立绘）
 * 只在「换过一次底」之后才成立，而默认的 `fade` 转场又必须整屏过色。
 * 四种转场各演一遍、每一场都带立绘，才看得出：
 *   - 立绘是否始终在背景之上（cut / dissolve 之后最容易露馅）
 *   - fade / fade-white 的纯色场是否盖住立绘与 CG（负向：不该出现「人物浮在黑场里」）
 *
 * 用法：node scripts/mockSpriteLayers.mjs [playId]
 *   playId 缺省 `mock-layers`，素材从 `plays/testtest/assets` 软链过来（背景+立绘都现成）。
 */
import { mkdir, writeFile, rm, symlink, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LineageTree } from "../packages/core/dist/lineage/model.js";
import { lineageToEvents, stopFromNode, toNodeView } from "../packages/core/dist/lineage/replay.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const playId = process.argv[2] ?? "mock-layers";
const dir = join(root, "plays", playId);
const ASSET_SRC = join(root, "plays", "testtest", "assets");

// 从 testtest 现成的素材里挑：三张背景 + 两个有立绘的角色
const BGS = ["bg_mary_gate", "bg_mary_corridor", "bg_mary_library"];
const CAST = [
  { id: "lilia", name: "莉莉亚", variants: ["smile", "neutral", "surprised"] },
  { id: "rin", name: "凛", variants: ["neutral", "thinking", "worried"] },
];
const TRANSITIONS = ["cut", "dissolve", "fade", "fade-white"];

const tree = new LineageTree();
let seq = 0;

function add(kind, text, extra = {}) {
  const span = kind === "say" || kind === "narrate" ? (text ? 3 : 2) : kind === "beat_end" ? 0 : 1;
  if (!span) return tree.append(kind, { text, payload: { ...extra } });
  const base = seq + 1;
  seq += span;
  return tree.append(kind, { text, payload: { seq: base, ...extra } });
}

// 每一场：换底（走一种转场）+ 上两个立绘 + 各说一句。第 2 场起 old 层才有东西可比。
TRANSITIONS.forEach((transition, i) => {
  add("scene", "", { attrs: { bg: BGS[i % BGS.length], transition } });
  add("narrate", `【${transition}】换底完成，台上应当有两个人。`);
  CAST.forEach((c, j) => {
    add("actor", "", { attrs: { id: c.id, pos: j === 0 ? "left" : "right", variant: c.variants[i % c.variants.length] } });
    add("say", `${c.name}：这是第 ${i + 1} 场，换底方式是 ${transition}。`, { attrs: { id: c.id } });
  });
  add("stop", "", { stopType: "pause" });
  add("beat_end", "", { reason: "pause" });
});

// 最后再补一场 CG：用来观察 CG 层与立绘层同时在场时的层序。
// 注意：实测二者并存时是 **CG 压住立绘**（`.theater-cg` 无 z-index，与 `.theater-sprites`
// 的 0 同处一个绘制档、按树序绘制，CG 在 DOM 里靠后）——本脚本只负责把这一场摆出来，
// 该层序是否符合预期另见 issue 文档的「待跟进」。
add("scene", "", { attrs: { bg: BGS[0], transition: "dissolve" } });
add("cg", "", { attrs: { id: "cg_threshold_reflection" } });
add("narrate", "插图与立绘同时在场：CG 在下、立绘在上。");
add("stop", "", { stopType: "pause" });
add("beat_end", "", { reason: "pause" });

await rm(dir, { recursive: true, force: true });
await mkdir(join(dir, "characters"), { recursive: true });
await writeFile(join(dir, "play.json"), `${JSON.stringify({ id: playId, title: "立绘层叠验证" }, null, 2)}\n`);

// 素材：整棵 assets 软链过来（背景/立绘/CG 一次到位，33MB 不复制）
await symlink(ASSET_SRC, join(dir, "assets"), "dir");

for (const c of CAST) {
  await writeFile(join(dir, "characters", `${c.id}.md`), `---\nid: ${c.id}\nname: ${c.name}\n---\n\n# ${c.name}\n\n验证层叠用的角色。\n`);
}

const now = Date.now();
const all = tree.export().events;
const events = all.map((e, j) => ({ ...e, createdAt: now - (all.length - j) * 40_000 }));
const view = tree.chainEvents(tree.leafId).map(toNodeView);
const stopNode = [...view].reverse().find((n) => n.kind === "stop");
// 阅读位置钉在第一句台词：不写这一格，恢复档会直接落在末尾，
// 舞台上永远只有最后一场，「逐场看四种转场」就无从谈起。
const firstLine = view.find((n) => n.kind === "say" || n.kind === "narrate");
const saveId = "layers01";
const saveDir = join(dir, "saves", saveId);
await mkdir(saveDir, { recursive: true });
await writeFile(
  join(saveDir, "meta.json"),
  JSON.stringify(
    {
      id: saveId,
      name: "层叠验证",
      createdAt: now,
      updatedAt: now,
      beats: view.filter((n) => n.kind === "beat_end").length,
      preview: TRANSITIONS.join(" / "),
    },
    null,
    2,
  ),
);
await writeFile(
  join(saveDir, "session.json"),
  JSON.stringify(
    {
      version: 1,
      lineage: { ...tree.export(), events },
      engine: { flags: {}, sceneDetails: {}, activeThreads: [] },
      scene: "层叠验证",
      runtime: {
        events: lineageToEvents(view),
        beatNo: view.filter((n) => n.kind === "beat_end").length,
        lastStop: stopNode ? stopFromNode(stopNode) : null,
        epoch: 1,
        ...(firstLine ? { readPos: { nodeId: firstLine.id, offset: 0 } } : {}),
      },
      savedAt: now,
    },
    null,
    2,
  ),
);
await writeFile(join(dir, "active.json"), JSON.stringify({ saveId }, null, 2));

const files = await readdir(join(ASSET_SRC, "backgrounds"));
console.log(`${playId}：存档 ${saveId}，${TRANSITIONS.length} 种转场各一场 + 1 场 CG，立绘角色 ${CAST.map((c) => c.id).join("/")}，背景 ${files.length} 张`);
