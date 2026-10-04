import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GeminiImageGen } from "../src/geminiImage.js";
import { Limiter } from "../src/limiter.js";
import { PlayFiles } from "../src/playFiles.js";
import { PlayStore } from "../src/store.js";
import { PlayAssets } from "../src/playAssets.js";
import type { ImageBackend } from "../src/imageBackend.js";

/**
 * 柚子社《千恋＊万花》四角色的**真实生图**端到端演练——走的是工坊出图的那条完整管线
 * （`PlayAssets` → Gemini 格式 → 抠底 → 落 `assets/sprites/<id>/`），不是裸客户端。
 *
 *   STAGE_E2E_LIVE=1 STAGE_IMAGE_API_KEY=<key> pnpm exec vitest run test/e2e-live-senren.test.ts
 *
 * 跑法就是产品约定的两轮节奏：
 *   1. 四个角色各出一张 `neutral` 定妆照（**同批并发**）——这一轮出完就停，
 *      因为「底图要用户确认过才准出其余差分」是产品铁律；
 *   2. 用户点头后，两个女主在同一批里并发出 6 个表情差分（**垫的是刚出的定妆照**）。
 *
 * 形象描述来自柚子社官方中文站（hikarifield.co.jp/senren）的角色立绘，逐项读图转写，
 * 目的是验证「一份外观描述 → 换表情不换脸」在真实模型上成不成立。
 *
 * **花钱，默认 skip。** 全量 16 次生图（4 定妆 + 12 差分）。先跑便宜的组合：
 *   SENREN_CHARS=yoshino SENREN_EXPRESSIONS=smile   → 2 次
 * 挑人的时候认这两条：内容安全过滤对「未成年 + 暴露着装」特别敏感，触发后是整条 500
 * 而不是 400（实测 17 岁 + bare legs 的组合被拦），改写描述比降级模型管用。
 */

const LIVE = process.env.STAGE_E2E_LIVE === "1";
const OUT = process.env.SENREN_OUT_DIR ?? join(tmpdir(), "senren-sprites");
const SIZE = (process.env.STAGE_IMAGE_SIZE ?? "1k") as "1k" | "2k" | "4k";

/** 四个角色的外观。identity 段进 neutral 的提示词，差分只换 expression。 */
interface Chara {
  id: string;
  name: string;
  identity: string;
}

/** 画风单独一栏：立绘的 2D 平涂 + 单一纯色底不是用户偏好，是抠底管线的硬要求（见 cutout.ts）。 */
const STYLE =
  "Japanese anime style 2D character illustration, flat cel shading with clean crisp lineart, " +
  "NOT a 3D render, no 3D CGI look. Plain solid chroma-key green background, no gradient.";

const ALL: Chara[] = [
  {
    id: "yoshino",
    name: "朝武芳乃",
    identity:
      "a 18-year-old shrine maiden girl with silver-white hair in high twin tails with long lengths falling down, " +
      "blue-violet eyes, a golden forehead crown ornament and red hair ties with long tassels. " +
      "She wears a white wide-sleeved miko top with pale pink cherry-blossom gradient pattern and a gold-trimmed " +
      "crimson collar, a long crimson hakama skirt, a red knotted cord with tassels at her waist, and traditional " +
      "tabi socks with wooden zori sandals. Warm, reserved expression, gentle and earnest presence.",
  },
  {
    id: "murasame",
    name: "丛雨",
    identity:
      "a 18-year-old spirit girl with long light-green hair tied into high side sections and long reddish-purple " +
      "ribbons, reddish-purple eyes, straight bangs. She wears a black Japanese-style off-the-shoulder wide-sleeved " +
      "garment with silver and white patterned trim at the neckline, a short black pleated skirt, a wide patterned red " +
      "obi fastened with a golden-yellow rope, and dark brown lace-up strappy sandals criss-crossed around her " +
      "ankles. Lively, cheerful, childlike and bright.",
  },
  {
    id: "masuko",
    name: "常陆茉子",
    identity:
      "a 18-year-old girl with short black hair, vivid green eyes, a few thin sidelocks falling in front of her chest, " +
      "and short bangs. She wears a modified white and purple Japanese-style wrap top over a cyan inner layer with a " +
      "lace-up corset sash around the torso, dark navy shorts, and short black-and-white trimmed socks. " +
      "Teasing, playful, easygoing and confident.",
  },
  {
    id: "masaomi",
    name: "有地将臣",
    identity:
      "a 18-year-old Japanese high school boy with short brown hair and long bangs falling over his eyes. He wears a " +
      "white zip-up hoodie over a burgundy shirt, dark trousers and white sneakers. Calm, earnest, disciplined, " +
      "with a quiet and reliable air about him.",
  },
];

/** 女主的 6 个表情差分；与 `neutral` 一起构成一整套立绘。 */
const ALL_EXPRESSIONS = ["smile", "shy", "surprised", "angry", "sad", "embarrassed"] as const;

function pick<T>(env: string, all: readonly T[], match: (item: T) => string): T[] {
  const raw = process.env[env];
  if (!raw) return [...all];
  const wanted = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return all.filter((item) => wanted.has(match(item)));
}

const CHARA = pick("SENREN_CHARS", ALL, (c) => c.id);
const EXPRESSIONS = pick("SENREN_EXPRESSIONS", ALL_EXPRESSIONS, (e) => e) as typeof ALL_EXPRESSIONS;
const HEROINES = CHARA.filter((c) => c.id === "yoshino" || c.id === "murasame");

function liveBackend(): ImageBackend {
  return new GeminiImageGen({
    baseUrl: process.env.STAGE_IMAGE_BASE_URL ?? "http://127.0.0.1:38000",
    apiKey: process.env.STAGE_IMAGE_API_KEY ?? "",
    model: process.env.STAGE_IMAGE_MODEL ?? "gemini-3.1-flash-image",
    size: SIZE,
    timeoutMs: 300_000,
  });
}

/** 一次性剧目目录：4 个角色卡，工坊的「角色 id 走 play.json 成员校验」要有真配置可对。 */
async function makeStore(): Promise<PlayStore> {
  const dir = await mkdtemp(join(tmpdir(), "stage-senren-"));
  await mkdir(join(dir, "memory", "always"), { recursive: true });
  await writeFile(
    join(dir, "play.json"),
    JSON.stringify({
      id: "senren",
      title: "千恋＊万花 立绘演练",
      premise: "柚子社废萌四角色的立绘生图演练。",
      characters: CHARA.map((c) => ({ id: c.id, name: c.name, persona: c.name })),
      opening: "（开始）",
      initialState: { turn: 0, affinity: {}, flags: {} },
      initialScene: "建实神社",
    }),
  );
  await writeFile(join(dir, "memory", "always", "premise.md"), "# 前提\n");
  await writeFile(join(dir, "lineage.jsonl"), "");
  return new PlayStore(dir);
}

async function setup(): Promise<{ assets: PlayAssets; playDir: string }> {
  const store = await makeStore();
  const files = new PlayFiles(store);
  const assets = new PlayAssets("senren", {
    store,
    files,
    backend: liveBackend(),
    limiter: new Limiter(Number(process.env.STAGE_IMAGE_CONCURRENCY ?? 6)),
    onWrite: () => {},
  });
  // 落盘到固定目录，方便事后翻图
  await mkdir(OUT, { recursive: true });
  return { assets, playDir: store.dir };
}

describe.skipIf(!LIVE)("E2E 柚子社四角色立绘（STAGE_E2E_LIVE=1 才跑，按 SENREN_CHARS 控成本）", () => {
  it(
    "第一轮：neutral 定妆照，同批并发",
    async () => {
      const { assets, playDir } = await setup();
      console.log(
        `[senren] 剧目目录 ${playDir}，出图尺寸 ${SIZE}，本轮 ${CHARA.length} 次生图` +
          `（${CHARA.map((c) => c.name).join("、")}）`,
      );

      // allSettled：网关的内容安全过滤是逐条触发的（实测「kunoichi」一词就整条 500），
      // 让一个角色挂掉把其余三个的结果一起吞掉，排查时什么都看不见。
      const settled = await Promise.allSettled(
        CHARA.map((c) =>
          assets.generate({ kind: "sprite", characterId: c.id, expression: "neutral" }, c.identity, STYLE),
        ),
      );

      const failed: string[] = [];
      for (const [i, r] of settled.entries()) {
        const chara = CHARA[i]!;
        if (r.status === "rejected") {
          failed.push(`${chara.name}: ${String(r.reason).slice(0, 120)}`);
          console.log(`[senren] 定妆照 ${chara.name} 失败：${String(r.reason).slice(0, 160)}`);
          continue;
        }
        expect(r.value, `${chara.name} 没有产出`).toHaveLength(1);
        const path = r.value[0]!.path;
        // 复制到固定目录：第二轮换了一个新的临时剧目目录，垫图得从这里搬。
        // 放在这里做是为了第一轮跑完就能直接翻图，不依赖进程状态。
        const dest = join(OUT, chara.id, "neutral.png");
        await mkdir(join(OUT, chara.id), { recursive: true });
        await copyFile(join(playDir, path), dest);
        console.log(`[senren] 定妆照 ${chara.name} → ${path}（另存 ${dest}）`);
      }
      expect(failed, `以下角色没出成定妆照：\n${failed.join("\n")}`).toHaveLength(0);
      console.log(`[senren] ${CHARA.length} 张定妆照全部落盘，图在 ${OUT}/`);
    },
    900_000,
  );

  it(
    "第二轮：表情差分同批并发，垫各自的 neutral",
    async () => {
      const { assets, playDir } = await setup();
      // 垫图一致性正是本轮要验的东西，垫图不存在就必须报错而不是悄悄出个新人。
      for (const chara of HEROINES) {
        const from = join(OUT, chara.id, "neutral.png");
        const to = join(playDir, "assets", "sprites", chara.id);
        await mkdir(to, { recursive: true });
        await copyFile(from, join(to, "neutral.png"));
      }

      const jobs = HEROINES.flatMap((c) => EXPRESSIONS.map((expression) => ({ c, expression })));
      console.log(`[senren] 同一批并发 ${jobs.length} 条（${HEROINES.length} 女主 × ${EXPRESSIONS.length} 表情）`);

      const settled = await Promise.allSettled(
        jobs.map((j) =>
          assets.generate(
            { kind: "sprite", characterId: j.c.id, expression: j.expression },
            `${j.c.identity} Facial expression: ${j.expression}.`,
            STYLE,
          ),
        ),
      );

      const failed: string[] = [];
      for (const [i, r] of settled.entries()) {
        const job = jobs[i]!;
        if (r.status === "rejected") {
          failed.push(`${job.c.name}/${job.expression}: ${String(r.reason).slice(0, 120)}`);
          console.log(`[senren] 差分 ${job.c.name}/${job.expression} 失败：${String(r.reason).slice(0, 160)}`);
          continue;
        }
        // 定妆照已存在时不返回 autoNeutral 那项，长度是 1 不是 2——这一轮要验的正是
        // 「不重新定妆、直接派生」，所以 autoNeutral 必须一条都不出现。
        expect(r.value.every((a) => a.autoNeutral), `${job.c.name}/${job.expression} 不该再自动补定妆照`).toBe(false);
        expect(r.value.at(-1)!.path).toBe(`assets/sprites/${job.c.id}/${job.expression}.png`);
        const src = join(playDir, r.value.at(-1)!.path);
        const dest = join(OUT, job.c.id, `${job.expression}.png`);
        await copyFile(src, dest);
        console.log(`[senren] 差分 ${job.c.name}/${job.expression} → ${dest}`);
      }
      expect(failed, `以下差分没出成：\n${failed.join("\n")}`).toHaveLength(0);
    },
    900_000,
  );
});
