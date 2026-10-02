import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { PreloadAssetAttrs, SpriteFraming } from "@stage-ai/core";
import type { PlayAssets } from "../playAssets.js";
import { linesResult, reason, textResult } from "./result.js";

/**
 * `generate_image`：两个 agent 共用的**同一份实现与 schema**，只有「描述 + 等待策略 + 依赖」不同。
 *
 * |  | 工坊（sync） | 剧作家（queued） |
 * |  | --- | --- | --- |
 * | 落点 | assets/（进 git，素材页可见） | bg/cg 落 media-cache 运行时缓存；立绘落 assets/ |
 * | 等待 | await，回执带 markdown 图片 | 发起即返回排产回执 |
 * | 立绘角色 | 必须在 play.json 里（成员校验） | 不在则用 characterName 自动注册 stub |
 * | 抠底参数 | 描述里教怎么用 | 不提（模型不该在拍内调抠底） |
 *
 * 工坊出图是**同步**的：用户就站在对话框前等，回执必须把图贴给他看。
 * 剧作家是**后台预发射**：一轮只有 240s，立绘一张约 100s，等不起也不该等——
 * 它的契约是「提前 3–5 句发起，之后再引用」。
 */
/**
 * 参数 schema 按角色裁剪：`expression`（立绘差分名）与 `referenceCharacters`（CG/背景的参考立绘）只有工坊有。
 *
 * 同一份实现、同一个工具名，但**剧作家拿不到这两个参数**：它的立绘只能是 neutral 定妆照，
 * 差分由工坊在用户眼前生成（垫图保一致性，见 SYNC_DESCRIPTION）；它的 bg/cg 走 media-cache 的
 * 后台排产链路（`ImageAssets`），那条链路不接垫图。参数层不给，比运行时回一句「不行」省掉
 * 一次白跑的往返——一轮只有 240s，浪费在拒绝上不划算。
 */
function imageParams(withExpression: boolean) {
  return Type.Object(
  {
    kind: Type.Union([Type.Literal("background"), Type.Literal("cg"), Type.Literal("sprite")]),
    /** 背景/CG 的素材 id，剧本里的 bg/cg id 就是它。 */
    name: Type.Optional(Type.String({ maxLength: 40 })),
    /** 立绘所属角色 id。 */
    characterId: Type.Optional(Type.String({ maxLength: 40 })),
    /** 剧作家专用：角色不在角色表时用这个名字自动注册（临时角色）。工坊侧不给，按成员校验报错。 */
    characterName: Type.Optional(Type.String({ maxLength: 40 })),
    /** 立绘差分名，如 neutral / smile（只有工坊有这个参数）。 */
    ...(withExpression ? { expression: Type.Optional(Type.String({ maxLength: 40 })) } : {}),
    /**
     * 参考立绘（只有工坊有这个参数；只对 kind=background / cg 生效）：把列出的角色立绘垫给模型，
     * **数组顺序就是提示词里「第一张图、第二张图」的顺序**，不能随意排。角色没有立绘会直接报错。
     */
    ...(withExpression
      ? {
          referenceCharacters: Type.Optional(
            Type.Array(Type.String({ maxLength: 40 }), { minItems: 1, maxItems: 6 }),
          ),
        }
      : {}),
    /** 立绘取景（只对 kind=sprite 生效；不给则沿用该角色已声明的，默认全身）。 */
    framing: Type.Optional(
      Type.Union([
        Type.Literal("bust", { description: "胸像：只到头肩" }),
        Type.Literal("half", { description: "半身：到腰" }),
        Type.Literal("full", { description: "全身：到脚" }),
      ]),
    ),
    /** 画风锚点（可选），如「厚涂写实电影感」「赛璐珞动画」。不给就不预设风格，按角色描述走。 */
    style: Type.Optional(Type.String({ maxLength: 200 })),
    /** 立绘抠底微调（可选，只对 kind=sprite 生效）。用 inspect_asset 看图觉得抠得不干净时才填（工坊侧）。 */
    cutout: Type.Optional(
      Type.Object(
        {
          /** 强阈值 0–32：确定是底色的种子。调大=保守少抠。默认 1。 */
          strong: Type.Optional(Type.Integer({ minimum: 0, maximum: 32 })),
          /** 弱阈值 0–64：种子沿轮廓的漫延范围。调大=顺着轮廓多啃几像素、毛边更干净。默认 8。 */
          weak: Type.Optional(Type.Integer({ minimum: 0, maximum: 64 })),
          /** 背景洞面积下限 0–10000：小于它的封闭背景块会填回人物（护眼白）。调小=抠得更狠。默认 200。 */
          minHole: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
          /** 掩膜降噪 0–8：色键跑在一张高斯模糊副本上（alpha 仍从原图解），专治 JPEG 环纹把轮廓咬出缺口。调大抗缺口、代价是边缘略毛。默认 0.8。 */
          keySmooth: Type.Optional(Type.Number({ minimum: 0, maximum: 8 })),
          /** 反解带宽 1–32：源图抗锯齿过渡带有多宽就得设多宽；不够宽会把渐变像素钉成实心，深色底上是一圈白块。默认 4。 */
          edgeBand: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })),
        },
        { additionalProperties: false },
      ),
    ),
    prompt: Type.String({ minLength: 1, maxLength: 4000, description: "英文出图提示词，描述画面本身（不含负面词）" }),
  },
  { additionalProperties: false },
  );
}

const generateImageParams = imageParams(true);
const playwriterImageParams = imageParams(false);

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
  "立绘的**取景用 framing 参数声明**（bust 胸像 / half 半身 / full 全身）：它决定画幅、构图与舞台上的站位，",
  "同一个角色要保持同一档；只有刻意做特写差分时才给某条差分换档。不给就沿用该角色已有的声明。",
  "立绘的抠底构图与画风后缀（纯白底、平涂、哪里要留白）由引擎自动拼在 prompt 末尾，别在 prompt 里",
  "重复也别改写它；背景与 CG 没有这层后缀，构图要求要自己写。",
].join("");

/**
 * 只给工坊：`referenceCharacters` 是工坊独有的参数，写进共享的 PROMPT_RULES 会让剧作家
 * 照着去调一个它 schema 里根本没有的参数——一次注定被拒的往返，外加一轮 240s 的预算。
 */
const REFERENCE_RULE = [
  "背景与 CG 里**有人物时用 referenceCharacters 垫立绘**（数组顺序即提示词里的先后顺序，别随意排）：",
  "画面里有人物却只靠文字描述，出来的脸和角色卡对不上；垫了图也不必省略 prompt 里的外貌描述——",
  "垫图锁的是那张定妆照的脸与服装，画面里的动作、姿态、与他人的相对位置仍然要 prompt 说。",
].join("");

const SYNC_DESCRIPTION = [
  "出一张剧目素材并落进 assets/：背景(kind=background) / CG(kind=cg) 给 name，",
  "立绘(kind=sprite) 给 characterId + expression。立绘会自动抠底成透明 PNG（引擎要靠它叠在场景上）。",
  "非 neutral 的立绘会自动拿该角色的 neutral 定妆照做垫图，所以同一个角色的差分是同一个人。",
  "背景与 CG 里有人物时，用 referenceCharacters 列出要垫立绘的角色（顺序即提示词里的先后顺序）。",
  PROMPT_RULES,
  REFERENCE_RULE,
  "一次工具调用只出一张图；要出多个差分就在同一个批次里多次调用本工具，它们是并行的。",
  "抠完觉得不干净（白边、剪纸毛刺）时，用 inspect_asset 看图，再带 cutout 参数重出。",
].join("");

const QUEUED_DESCRIPTION = [
  "出一张剧目素材并**后台排产**（发起即返回，不等图）：背景(kind=background) / CG(kind=cg) 给 name，",
  "立绘(kind=sprite) 给 characterId，出的**只能是 neutral 定妆照**（差分由工坊在用户面前生成，别试也别写 expression）。" +
  "角色不在角色表时再给 characterName，会自动建一个临时角色。",
  "背景 16:9、CG 16:9、立绘竖构图（取景 full 用 9:16、half 3:4、bust 1:1）；提示词写英文，只描述画面本身。",
  PROMPT_RULES,
  "**提前 3–5 句发起**：图要一分多钟才到（实测 1k 档 70–80s、2k 档 110s 上下），" +
  "出席位置太早只会看到骨架占位，拿到回执后照常写台词，",
  "到出场的那一行再用 <scene bg=\"…\"> 或 <cg id=\"…\">、<actor expression=\"…\"> 引用同一个 id。",
  "回执会告诉你这张是新建排产、已经在队列里，还是剧目里已经有同名素材（已有的直接引用，别重复发起）。",
  "立绘会自动抠底成透明 PNG。**这个工具没有 expression 参数**：要别的表情就引用角色表里已有的差分，没有就先用 neutral。",
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
  kick: (type: "bg" | "cg", prompt: string, id: string) => void;
  /** 后台发起立绘（宿主负责失败广播）。 */
  kickSprite: (
    charId: string,
    expression: string,
    prompt: string,
    characterName?: string,
    framing?: SpriteFraming,
  ) => void;
  /** 这个 id 在运行时缓存里是什么状态（决定要不要重复发起）。 */
  statusOf: (id: string) => "ready" | "queued" | "none";
  /** 这个 id 的背景/插图是不是已经在 assets/ 里（工坊导入的静态素材）——有就不烧配额。 */
  hasStaticAsset: (type: "bg" | "cg", id: string) => boolean;
}

export type ImageToolDeps = SyncImageDeps | QueuedImageDeps;

export function createGenerateImageTool(deps: ImageToolDeps): AgentTool<typeof generateImageParams> {
  return {
    name: "generate_image",
    label: "生成剧目素材",
    description: deps.mode === "sync" ? SYNC_DESCRIPTION : QUEUED_DESCRIPTION,
    parameters: deps.mode === "sync" ? generateImageParams : playwriterImageParams,
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

/** 工坊：等图出完，回执里贴 markdown 图片。 */
async function runSync(
  deps: SyncImageDeps,
  params: Static<typeof generateImageParams>,
): Promise<ReturnType<typeof linesResult>> {
  const assets = deps.playAssets!;
  const generated = await assets.generate(
    {
      kind: params.kind,
      name: params.name,
      characterId: params.characterId,
      expression: typeof params.expression === "string" ? params.expression : undefined,
      framing: params.framing,
      referenceCharacters: Array.isArray(params.referenceCharacters)
        ? params.referenceCharacters.filter((id): id is string => typeof id === "string")
        : undefined,
    },
    params.prompt,
    params.style,
    params.cutout,
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
  if (params.kind === "sprite") {
    const charId = params.characterId?.trim() ?? "";
    if (!charId) throw new Error("立绘必须给 characterId（角色 id）");
    if (await assets.exists({ kind: "sprite", characterId: charId, expression: "neutral" })) {
      return textResult(`${charId} 的 neutral 立绘剧目里已经有了，直接 <actor id="${charId}"> 引用，不用重出。`);
    }
    deps.emitPreload({ type: "sprite", id: `${charId}:neutral`, prompt: params.prompt });
    deps.kickSprite(charId, "neutral", params.prompt, params.characterName?.trim() || undefined, params.framing);
    return textResult(
      `已排产：立绘 ${charId}/neutral（约一分多钟）。` +
        "别在这一轮就让它上台，3–5 句之后再 <actor id=…>；角色表里还没有它时会自动建一个临时角色。" +
        "这个工具不产差分：别的表情用角色表里已有的，没有就先用中性表情顶上。",
    );
  }
  const id = params.name?.trim() ?? "";
  if (!id) throw new Error("背景/CG 必须给 name（素材 id，剧本里的 bg/cg id 就是它）");
  const type = params.kind === "background" ? "bg" : "cg";
  // 骨架占位只在图**真的要来**的时候占位：已经在 assets/ 里或早就生成过的 id，
  // 占位等不到 asset_ready，只会白闪到超时。
  if (deps.hasStaticAsset(type, id)) {
    return textResult(`剧目里已经有同名${type === "bg" ? "背景" : "插图"}（assets/），跳过生成，直接引用 ${id}。`);
  }
  const status = deps.statusOf(id);
  if (status === "ready") return textResult(`${id} 这张图之前已经生成过，直接引用，别再发起。`);
  // 在飞/排队：图确实会来，占位是对的（tool 不等图，模型这一轮就往下写）
  deps.emitPreload({ type, id, prompt: params.prompt });
  if (status === "queued") return textResult(`${id} 已经在生成队列里了（同一个 id 不会出两张图），照常在出场处引用。`);
  deps.kick(type, params.prompt, id);
  return textResult(
    `已排产：${id}（${type}，约一分多钟）。3–5 句之后用 ${type === "bg" ? `<scene bg="${id}">` : `<cg id="${id}">`} 引用它。`,
  );
}
