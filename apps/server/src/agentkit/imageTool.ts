import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { InferArgs } from "@aivn/agent";
import { COMMON_SPRITE_VARIANTS, type PreloadAssetAttrs, type SpriteFraming, type SpriteStature } from "@aivn/core";
import {
  IMAGE_PROMPT_RULES,
  IMAGE_REFERENCE_RULE,
  imageGenerateFields,
  pick,
  resolveImageRefs,
  tighten,
} from "@aivn/agent";
import type { AssetTarget, KeyBackgroundColor, PlayAssets } from "../playAssets.js";
import { toPi } from "./schema.js";
import { linesResult, reason, textResult } from "./result.js";
/**
 * `generate_image`：两个 agent 共用的**同一份实现与 schema**。
 *
 * |  | 工坊（sync） | 剧作家（queued） |
 * | --- | --- | --- |
 * | 等待 | await，回执带 markdown 图片 | 发起即返回排产回执 |
 * | 立绘主体 | 给 spriteId 即可（有没有角色卡都行） | 同左 |
 *
 * 抠底参数不在这里：填它得先看过成图，而出图那一刻没人看过图。改抠底是工坊在用户面前
 * 看到脏边之后的事，走单独的 `cut`（`source` 给 `sprite:<主体id>[/<差分>]`，拿留底原片原地重抠，不重新出图）。
 *
 * 落点是**草稿区**：工坊出的是草稿（挑中了才由 `commit_asset` 入库），剧作家的后台预发射
 * 直接 `draft + commit` 一次做完——那边没有「让用户在候选里挑」这回事，工具调用本身就声明了最终 id。
 * 工具能力也**不分角色**——`variant` 与 `references` 两个角色都拿得到，
 * 垫图可以是任一主体的立绘、剧目内路径或网络图，与谁调的无关。要不要给剧作家开这个工具由设置页决定。
 *
 * 工坊出图是**同步**的：用户就站在对话框前等，回执必须把图贴给他看。
 * 剧作家是**后台预发射**：一轮只有 240s，立绘一张约 100s，等不起也不该等——
 * 它拿到回执就接着写台词，引用的位置早于图到货时舞台先上骨架占位（到货后自动淡入）。
 */
/** 工具面：除 `aspectRatio` 外都露（服务端的画幅由 kind/framing 推），范围由 pi 硬校验。 */
const FACE = tighten(
  pick(imageGenerateFields, [
    "kind",
    "name",
    "spriteId",
    "variant",
    "references",
    "referenceCharacters",
    "framing",
    "stature",
    "title",
    "keyColor",
    "style",
    "prompt",
  ]),
  {
    name: { maxLength: 40 },
    spriteId: { maxLength: 40 },
    variant: { maxLength: 40 },
    references: { minItems: 1, maxItems: 6 },
    referenceCharacters: { minItems: 1, maxItems: 6 },
    title: { maxLength: 40 },
    style: { maxLength: 200 },
    prompt: { minLength: 1, maxLength: 4000 },
  },
);

const generateImageParams = toPi(FACE);

/** 参数类型由能力的 fields 反推；运行期校验由上面编译出来的 TypeBox 承担。 */
type ImageArgs = InferArgs<typeof imageGenerateFields>;


/**
 * 写 prompt 的硬约束，两个角色共享。
 *
 * 放这里而不是放各自的 system prompt：这份 description 是两个角色唯一共用的工具说明，
 * 写在提示词里的同一条规则只会修到一侧——外貌锚点那条就只加过工坊，剧作家出的
 * 第一张立绘照样不贴角色卡。流程与验收（什么时候发起、出完怎么核对、失败怎么转述）
 * 各归各的提示词，那是角色职责，不是工具契约。
 */


const SYNC_DESCRIPTION = [
  "出一张剧目素材的**草稿**（背景 kind=background / CG kind=cg / 立绘 kind=sprite）：",
  "背景与 CG 给 name；立绘给 spriteId + variant（variant 不给按 neutral）。立绘会自动抠底成透明 PNG（引擎要靠它叠在场景上）。",
  "背景与 CG 一律 16:9 横构图；立绘的画幅跟着 framing 参数走，不用为了构图去改画幅。",
  "**草稿不是素材**：图落在临时草稿区，回执里给 draftId 与预览；要让它正式进剧目（写进 assets/ 与素材表），再调 commit_asset(draftId=\"…\")。",
  "**要出多张候选**：同一目标多调几次本工具（每张 prompt 各不相同；定妆照候选就给同一个 variant=neutral），",
  "把预览一起贴给用户，用户挑中哪张就只 commit 那一张——没被挑中的候选不会在素材表里留下任何痕迹。",
  "**定妆照（neutral）建议一次出 3 张候选让用户挑**：挑定并采用之后，再据它派生其余差分。",
  "非 neutral 的立绘会自动拿该主体**已入库的** neutral 定妆照做垫图，所以同一个主体的差分是同一个人；",
  "**该主体还没有入库的 neutral 时不能出别的差分**（草稿当不了身份基准）——先把 neutral 出了、采用一张。",
  IMAGE_PROMPT_RULES,
  IMAGE_REFERENCE_RULE,
  "一次工具调用只出一张图；要出多个候选或差分就在同一个批次里多次调用本工具，它们是并行的。",
  "抠底不用你管：引擎自动抠；用户看了成图说抠得不干净时用 cut 原地重抠（source 给 `sprite:<主体id>`，别重新出图——重新出图出来的是另一张画）。",
].join("");

const QUEUED_DESCRIPTION = [
  "出一张剧目素材并**后台排产**（发起即返回，不等图）：背景(kind=background) / CG(kind=cg) 给 name，",
  "立绘(kind=sprite) 给 spriteId + variant（variant 不给按 neutral）。spriteId 是立绘目录名，通常就是剧本里 <actor id> 引用的名字，",
  "**没有角色卡也能出**（机甲、道具、猫、只在一轮里出现的路人都是这样）；有同名卡时按卡上的人设写外观。",
  "没有角色卡又想给主体一个显示名，带 title=名称，舞台名牌就用它；",
  "角色卡是「这个人是谁」的正式落点，要人设、音色、长期出场才值得建（那是工坊与用户的活）。",
  "背景 16:9、CG 16:9、立绘竖构图（取景 full 用 9:16、half 3:4、square 1:1）；提示词写英文，只描述画面本身。",
  IMAGE_PROMPT_RULES,
  IMAGE_REFERENCE_RULE,
  "**走函数调用**：本工具是函数调用，不是剧本里的文本标签。写成 <call:generate_image …/> 那样夹在台词之间，",
  "引擎不认，那张图不会出现，也不会有人告诉你出错了。",
  "背景与 CG 的 prompt 末尾自己加 \"anime visual novel background, no text\"；立绘的后缀引擎自动拼，别在 prompt 里重复。",
  "**id 自取**：背景与 CG 给一个简短英文下划线 id（如 bg_rooftop_dusk、cg_rooftop_01），",
  "之后在剧本里一字不差地引用同一个 id：<scene bg=\"…\">、<cg id=\"…\">、<actor id=\"…\" variant=\"…\">。",
  "**图到货要一分多钟**（实测 1k 档 70–80s、2k 档 110s 上下）：这一轮就引用到它，舞台会先上骨架占位，",
  "台词照常演、图到货后自动淡入——照常写就行，不用为了等图停下来。",
  "回执会告诉你剧目里是不是已经有同名素材——有就直接引用，别重复发起。",
].join("");

/**
 * 工坊：同步出图，**只出草稿**，回执与素材气泡都带草稿预览。
 *
 * 入库是另一件事（`commit_asset`）：工坊要先能一次出几张候选让用户挑，挑中的那张才进
 * `assets/`。草稿也走 `onAsset` 推气泡——候选图得摆在对话里让用户直接看见、点开对比，
 * 只塞在工具回执里（默认折叠）等于让人自己去找。
 */
export interface SyncImageDeps {
  mode: "sync";
  playAssets?: PlayAssets;
  onAsset: (
    path: string,
    url: string,
    kind: "background" | "cg" | "sprite",
    replaced: boolean,
    toolCallId: string,
  ) => void;
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
  kickSprite: (target: {
    spriteId: string;
    variant: string;
    prompt: string;
    framing?: SpriteFraming;
    stature?: SpriteStature;
    title?: string;
    keyColor?: KeyBackgroundColor;
    references?: string[];
  }) => void;
  /** 这个目标在剧目里已有素材的静态 URL（用户导入的或之前生成的）——有就不烧配额。 */
  existingAssetUrl: (target: AssetTarget) => Promise<string | null>;
}

export type ImageToolDeps = SyncImageDeps | QueuedImageDeps;

export function createGenerateImageTool(deps: ImageToolDeps): AgentTool<any> {
  return {
    name: "generate_image",
    label: "生成剧目素材",
    description: deps.mode === "sync" ? SYNC_DESCRIPTION : QUEUED_DESCRIPTION,
    parameters: generateImageParams,
    execute: async (toolCallId, params: unknown) => {
      if (!deps.playAssets && deps.mode === "queued") {
        return textResult(
          "生图未启用（STAGE_IMAGE_ENABLED=false 或后端缺凭据）：别在剧本里引用没见过的素材 id，用旁白/台词交代。",
        );
      }
      if (!deps.playAssets) {
        return textResult("生图未启用（STAGE_IMAGE_ENABLED=false 或后端缺凭据）：把该出的图列给用户，让用户在素材页上传。");
      }
      try {
        const args = params as ImageArgs;
        return deps.mode === "sync"
          ? await runSync(deps, args, toolCallId)
          : await runQueued(deps, args);
      } catch (error) {
        return textResult(`生图失败：${reason(error)}`);
      }
    },
  };
}


/** 工坊：等图出完，回执里贴草稿预览 + draftId（入库另走 commit_asset）。 */
async function runSync(
  deps: SyncImageDeps,
  params: ImageArgs,
  toolCallId: string,
): Promise<ReturnType<typeof linesResult>> {
  const assets = deps.playAssets!;
  const references = resolveImageRefs(params);
  const draft = await assets.draft(
    {
      kind: params.kind,
      name: params.name,
      spriteId: typeof params.spriteId === "string" ? params.spriteId : undefined,
      variant: typeof params.variant === "string" ? params.variant : undefined,
      framing: params.framing,
      stature: params.stature,
      title: typeof params.title === "string" ? params.title : undefined,
      keyColor: params.keyColor,
      references,
      referenceCharacters: references,
    },
    params.prompt,
    params.style,
  );
  deps.onAsset(draft.path, draft.url, draft.kind, false, toolCallId);
  return linesResult([
    `草稿已出：\`${draft.draftId}\``,
    `![${draft.draftId}](${draft.url})`,
    "这张**还没进素材表**。要采用它就调 `commit_asset(draftId=\"…\")`；要换一张就再出一次候选。",
  ]);
}

/** 剧作家：占住时间线上的位置后立刻返回，不等图。 */
async function runQueued(
  deps: QueuedImageDeps,
  params: ImageArgs,
): Promise<ReturnType<typeof linesResult>> {
  const assets = deps.playAssets!;
  const references = resolveImageRefs(params);
  if (params.kind === "sprite") {
    const spriteId = params.spriteId?.trim() ?? "";
    if (!spriteId) throw new Error("立绘必须给 spriteId（主体 id，剧本里 <actor id> 引用的那个名字）");
    const variant = params.variant?.trim() || "neutral";
    if (await assets.exists({ kind: "sprite", spriteId, variant })) {
      return textResult(`${spriteId} 的 ${variant} 立绘剧目里已经有了，直接 <actor id="${spriteId}"> 引用，不用重出。`);
    }
    deps.emitPreload({ type: "sprite", id: `${spriteId}:${variant}`, prompt: params.prompt });
    deps.kickSprite({
      spriteId,
      variant,
      prompt: params.prompt,
      framing: params.framing,
      stature: params.stature,
      title: typeof params.title === "string" ? params.title.trim() || undefined : undefined,
      keyColor: params.keyColor,
      references,
    });
    return textResult(
      `已排产：立绘 ${spriteId}/${variant}（约一分多钟，到货后自动淡入）。` +
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
