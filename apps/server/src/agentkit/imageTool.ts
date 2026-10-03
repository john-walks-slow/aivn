import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { PreloadAssetAttrs, SpriteFraming } from "@stage-ai/core";
import type { AssetTarget, PlayAssets } from "../playAssets.js";
import { linesResult, reason, textResult } from "./result.js";

/**
 * `generate_image`：两个 agent 共用的**同一份实现与 schema**。
 *
 * |  | 工坊（sync） | 剧作家（queued） |
 * | --- | --- | --- |
 * | 等待 | await，回执带 markdown 图片 | 发起即返回排产回执 |
 * | 立绘角色 | 必须在角色卡目录里，或带 characterName 自动建最小卡 | 同左 |
 *
 * 抠底参数不在这里：填它得先看过成图，而出图那一刻没人看过图。改抠底是工坊在用户面前
 * 看到脏边之后的事，走单独的 `recut_sprite`（原地重抠，不重新出图）。
 *
 * 落点两边一样：都进 `assets/`（工坊与剧作家共用同一个 PlayAssets）。
 * 工具能力也**不分角色**——`expression` 与 `references` 两个角色都拿得到，
 * 垫图可以是角色立绘、剧目内路径或网络图，与谁调的无关。要不要给剧作家开这个工具由设置页决定。
 *
 * 工坊出图是**同步**的：用户就站在对话框前等，回执必须把图贴给他看。
 * 剧作家是**后台预发射**：一轮只有 240s，立绘一张约 100s，等不起也不该等——
 * 它拿到回执就接着写台词，引用的位置早于图到货时舞台先上骨架占位（到货后自动淡入）。
 */
const generateImageParams = Type.Object(
  {
    kind: Type.Union([Type.Literal("background"), Type.Literal("cg"), Type.Literal("sprite")]),
    /** 背景/CG 的素材 id，剧本里的 bg/cg id 就是它。 */
    name: Type.Optional(Type.String({ maxLength: 40 })),
    /** 立绘所属角色 id（角色卡的文件名主体）。 */
    characterId: Type.Optional(Type.String({ maxLength: 40 })),
    /**
     * 角色表里还没有 characterId 时的显示名：带上它就自动建一张最小角色卡。
     * 戏里临时冒出来的人（路人、店员）走这条——工坊与用户此刻不在场，等他们想起建卡，
     * 这一轮早演过去了。给一个有卡的角色带这个参数没有额外作用（不会覆盖已有的人设）。
     */
    characterName: Type.Optional(Type.String({ maxLength: 40 })),
    /** 立绘差分名，如 neutral / smile。不给按 neutral。 */
    expression: Type.Optional(Type.String({ maxLength: 40 })),
    /**
     * 参考图（垫图）：可给角色 id（自动引用其立绘）、剧目内路径（如 assets/backgrounds/ref.png）或 http(s) URL。
     * - 出定妆照(neutral)时传它，垫图生成该角色的初始形象；
     * - 出 CG/背景时传它，垫出指定角色或画面的参考；
     * - 数组顺序即提示词里「第一张、第二张」的顺序。
     */
    references: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 2000 }), { minItems: 1, maxItems: 6 }),
    ),
    /**
     * 兼容别名：等同于 references 中传入角色 id 列表。
     */
    referenceCharacters: Type.Optional(Type.Array(Type.String({ maxLength: 40 }), { minItems: 1, maxItems: 6 })),
    /** 立绘取景（只对 kind=sprite 生效；不给则沿用该角色已声明的，默认全身）。 */
    framing: Type.Optional(
      Type.Union([
        Type.Literal("full", { description: "全身：人到脚。人物立绘的常规选择" }),
        Type.Literal("half", { description: "半身：到腰。对话时人物更大更清楚" }),
        Type.Literal("square", { description: "方形：正方画幅、主体完整入画。给猫、道具这类非人主体" }),
      ]),
    ),
    /** 画风锚点（可选），如「厚涂写实电影感」「赛璐珞动画」。不给就不预设风格，按角色描述走。 */
    style: Type.Optional(Type.String({ maxLength: 200 })),
    prompt: Type.String({ minLength: 1, maxLength: 4000, description: "英文出图提示词，描述画面本身（不含负面词）" }),
  },
  { additionalProperties: false },
);


/**
 * 写 prompt 的硬约束，两个角色共享。
 *
 * 放这里而不是放各自的 system prompt：这份 description 是两个角色唯一共用的工具说明，
 * 写在提示词里的同一条规则只会修到一侧——外貌锚点那条就只加过工坊，剧作家出的
 * 第一张立绘照样不贴角色卡。流程与验收（什么时候发起、出完怎么核对、失败怎么转述）
 * 各归各的提示词，那是角色职责，不是工具契约。
 */
const PROMPT_RULES = [
  "写 prompt：",
  "画面里出现角色时，**逐条带上角色卡的外貌**——发色、发型与长度、发饰、瞳色、脸上记号（泪痣、眼镜）、",
  "上衣、领巾或领结、裙、袜、鞋、手里拿着的东西，一条一条写进 prompt；角色卡没写的不要自己发明。",
  "只写「a girl with pink hair」这种泛化描述，等于把衣服和配件交给模型默认，出来的人不是卡上那个人",
  "（实测：人设写白百褶裙 + 黑过膝袜 + 颈上拍立得，图里出来藏青裙 + 白中短袜 + 肩上包）。",
  "非 neutral 的立绘会自动垫上该角色的 neutral 定妆照，**垫图就是身份基准**：prompt 里只写这次要改的东西",
  "（表情、姿势、角度），别重新描述长相——重写一遍会和垫图打架。垫图也**不会**把姿势锁回站桩：",
  "实测「垫图 + 明确写姿势机位」照样能出俯视坐姿、拾级而下的动态画面，只垫图不写姿势则一定是正面站桩。",
  "**姿势、机位、景别都要显式写**：只说「她站在天台上」出来是对称站立的正面像，要说清机位（平视/俯视/仰视/侧身回眸）",
  "、动作（坐/走/倚靠栏杆/回头）与景别（full body / medium shot / close-up）——不写景别，袜子、鞋这类细节直接出框。",
  "立绘的**取景用 framing 参数声明**（full 全身 / half 半身 / square 方形）：它决定画幅、构图与舞台上的站位，" +
  "同一个角色要保持同一档。人物用 full 或 half；**猫、道具这类非人主体用 square**——" +
  "「全身/半身」是人形术语，套到它们身上语义不通，正方画幅也让主体占满画布、不浪费上下空间。" +
  "不给就沿用该角色已有的声明。",
  "立绘的抠底构图与画风后缀（纯白底、平涂、哪里要留白）由引擎自动拼在 prompt 末尾，别在 prompt 里",
  "重复也别改写它；背景与 CG 没有这层后缀，构图要求要自己写。",
].join("");

/** 垫图规则：两个角色都拿得到 `references` 与 `referenceCharacters`，所以它属于共享的工具契约。 */
const REFERENCE_RULE =
  "画面里需要依据既有形象或素材时用 **references**（或兼容易懂的 referenceCharacters）垫图（可给角色 id、剧目内相对路径或 http(s) 网址；数组顺序即提示词里的先后顺序）：" +
  "出 **neutral 定妆照**时传 references，以给定参考图为基准生成角色初始立绘；" +
  "背景与 CG 里有人物时传入对应角色立绘或参考图，出来的脸和设定才对得上。" +
  "**非 neutral 的立绘差分不吃 references**——它的身份基准恒为该角色的 neutral 定妆照，要换基准就把 neutral 重出一遍。" +
  "垫了图也不必省略 prompt 里的外貌描述——垫图锁的是脸与核心特征，画面里的动作、姿态、相对位置仍然要 prompt 说。";

const SYNC_DESCRIPTION = [
  "出一张剧目素材并落进 assets/：背景(kind=background) / CG(kind=cg) 给 name，",
  "立绘(kind=sprite) 给 characterId + expression（不给按 neutral）。立绘会自动抠底成透明 PNG（引擎要靠它叠在场景上）。",
  "非 neutral 的立绘会自动拿该角色的 neutral 定妆照做垫图，所以同一个角色的差分是同一个人。",
  PROMPT_RULES,
  REFERENCE_RULE,
  "一次工具调用只出一张图；要出多个差分就在同一个批次里多次调用本工具，它们是并行的。",
  "抠底不用你管：引擎自动抠，用户看了成图说抠得不干净时用 recut_sprite 原地重抠，别重新出图。",
].join("");

const QUEUED_DESCRIPTION = [
  "出一张剧目素材并**后台排产**（发起即返回，不等图）：背景(kind=background) / CG(kind=cg) 给 name，",
  "立绘(kind=sprite) 给 characterId + expression（不给按 neutral）。characterId 是已有角色卡的角色；",
  "**戏里临时冒出来的人**（路人、店员）带 characterName=显示名 一起给，会自动建一张最小角色卡——",
  "工坊与用户此刻不在场，等他们想起建卡，这一轮早演过去了；有卡的角色别带这个参数，人设不会被覆盖。",
  "背景 16:9、CG 16:9、立绘竖构图（取景 full 用 9:16、half 3:4、square 1:1）；提示词写英文，只描述画面本身。",
  PROMPT_RULES,
  REFERENCE_RULE,
  "**走函数调用**：本工具是函数调用，不是剧本里的文本标签。写成 <call:generate_image …/> 那样夹在台词之间，",
  "引擎不认，那张图不会出现，也不会有人告诉你出错了。",
  "背景与 CG 的 prompt 末尾自己加 \"anime visual novel background, no text\"；立绘的后缀引擎自动拼，别在 prompt 里重复。",
  "**id 自取**：背景与 CG 给一个简短英文下划线 id（如 bg_rooftop_dusk、cg_rooftop_01），",
  "之后在剧本里一字不差地引用同一个 id：<scene bg=\"…\">、<cg id=\"…\">、<actor expression=\"…\">。",
  "**图到货要一分多钟**（实测 1k 档 70–80s、2k 档 110s 上下）：这一轮就引用到它，舞台会先上骨架占位，",
  "台词照常演、图到货后自动淡入——照常写就行，不用为了等图停下来。",
  "回执会告诉你剧目里是不是已经有同名素材——有就直接引用，别重复发起。",
].join("");

/** 工坊：同步出图，回执带图片给用户看。 */
export interface SyncImageDeps {
  mode: "sync";
  playAssets?: PlayAssets;
  onAsset: (path: string, url: string, kind: "background" | "cg" | "sprite", replaced: boolean) => void;
}

/** 剧作家：后台排产，先占时间线上的位置，生成结果由宿主广播。 */
export interface QueuedImageDeps {
  mode: "queued";
  playAssets?: PlayAssets;
  /** 生图预发射 → IR 事件（骨架占位出现在时间线上那个位置）。 */
  emitPreload: (attrs: PreloadAssetAttrs) => void;
  /** 后台发起 bg/cg（宿主负责到货广播 asset_ready / 失败 asset_failed）。 */
  kick: (type: "bg" | "cg", prompt: string, id: string, references?: string[]) => void;
  /** 后台发起立绘：同上的失败广播。references 只在出 neutral 定妆照时有意义。 */
  kickSprite: (charId: string, expression: string, prompt: string, framing?: SpriteFraming, references?: string[]) => void;
  /** 这个目标在剧目里已有素材的静态 URL（用户导入的或之前生成的）——有就不烧配额。 */
  existingAssetUrl: (target: AssetTarget) => Promise<string | null>;
}

export type ImageToolDeps = SyncImageDeps | QueuedImageDeps;

export function createGenerateImageTool(deps: ImageToolDeps): AgentTool<typeof generateImageParams> {
  return {
    name: "generate_image",
    label: "生成剧目素材",
    description: deps.mode === "sync" ? SYNC_DESCRIPTION : QUEUED_DESCRIPTION,
    parameters: generateImageParams,
    execute: async (_toolCallId, params: Static<typeof generateImageParams>) => {
      if (!deps.playAssets && deps.mode === "queued") {
        return textResult(
          "生图未启用（STAGE_IMAGE_ENABLED=false 或后端缺凭据）：别在剧本里引用没见过的素材 id，用旁白/台词交代。",
        );
      }
      if (!deps.playAssets) {
        return textResult("生图未启用（STAGE_IMAGE_ENABLED=false 或后端缺凭据）：把该出的图列给用户，让用户在素材页上传。");
      }
      try {
        return deps.mode === "sync"
          ? await runSync(deps, params)
          : await runQueued(deps, params);
      } catch (error) {
        return textResult(`生图失败：${reason(error)}`);
      }
    },
  };
}

/**
 * 合并两个参考图参数（`references` 与兼容别名 `referenceCharacters`）成一份有序列表。
 * 去重与封顶 6 张都在这里做：两个字段各自合法时合并起来可能超出生图后端的入参上限。
 */
function resolveRefs(params: Static<typeof generateImageParams>): string[] | undefined {
  const merged: string[] = [];
  for (const field of [params.references, params.referenceCharacters]) {
    if (!Array.isArray(field)) continue;
    for (const item of field) {
      if (typeof item !== "string") continue;
      const value = item.trim();
      if (value && !merged.includes(value)) merged.push(value);
    }
  }
  return merged.length > 0 ? merged.slice(0, 6) : undefined;
}

/** 工坊：等图出完，回执里贴 markdown 图片。 */
async function runSync(
  deps: SyncImageDeps,
  params: Static<typeof generateImageParams>,
): Promise<ReturnType<typeof linesResult>> {
  const assets = deps.playAssets!;
  const references = resolveRefs(params);
  const generated = await assets.generate(
    {
      kind: params.kind,
      name: params.name,
      characterId: params.characterId,
      characterName: typeof params.characterName === "string" ? params.characterName : undefined,
      expression: typeof params.expression === "string" ? params.expression : undefined,
      framing: params.framing,
      references,
      referenceCharacters: references,
    },
    params.prompt,
    params.style,
  );
  const lines = generated.map((asset) => {
    deps.onAsset(asset.path, asset.url, asset.kind, asset.replaced);
    return `${asset.replaced ? "已生成并覆盖原有素材" : "已生成"}：${asset.path}\n![${asset.path}](${asset.url})`;
  });
  const auto = generated.find((asset) => asset.autoNeutral);
  if (auto) lines.push("该角色原本没有任何差分，已先自动出一张 neutral 定妆照。");
  return linesResult(lines);
}

/** 剧作家：占住时间线上的位置后立刻返回，不等图。 */
async function runQueued(
  deps: QueuedImageDeps,
  params: Static<typeof generateImageParams>,
): Promise<ReturnType<typeof linesResult>> {
  const assets = deps.playAssets!;
  const references = resolveRefs(params);
  if (params.kind === "sprite") {
    const charId = params.characterId?.trim() ?? "";
    if (!charId) throw new Error("立绘必须给 characterId（角色 id）");
    const expression = params.expression?.trim() || "neutral";
    if (await assets.exists({ kind: "sprite", characterId: charId, expression })) {
      return textResult(`${charId} 的 ${expression} 立绘剧目里已经有了，直接 <actor id="${charId}"> 引用，不用重出。`);
    }
    deps.emitPreload({ type: "sprite", id: `${charId}:${expression}`, prompt: params.prompt });
    deps.kickSprite(charId, expression, params.prompt, params.framing, references);
    return textResult(
      `已排产：立绘 ${charId}/${expression}（约一分多钟，到货后自动淡入）。` +
        "这一轮就让它上台的话，舞台先上骨架占位，到货后自动淡入。",
    );
  }
  const id = params.name?.trim() ?? "";
  if (!id) throw new Error("背景/CG 必须给 name（素材 id，剧本里的 bg/cg id 就是它）");
  const type = params.kind === "background" ? "bg" : "cg";
  const label = type === "bg" ? "背景" : "插图";
  // 骨架占位只在图**真的要来**的时候占位：剧目里已有同名素材（用户导入或之前生成的）时，
  // 占位等不到 asset_ready，只会白闪到超时。
  if (await deps.existingAssetUrl({ kind: params.kind, name: id })) {
    return textResult(`剧目里已经有同名${label}，跳过生成，直接引用 ${id}。`);
  }
  deps.emitPreload({ type, id, prompt: params.prompt });
  deps.kick(type, params.prompt, id, references);
  return textResult(
    `已排产：${id}（${type}，约一分多钟，到货后自动淡入）。用 ${type === "bg" ? `<scene bg="${id}">` : `<cg id="${id}">`} 引用它。`,
  );
}
