import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import {
  assetGenerate,
  assetGenerateFields,
  resolveImageRefs,
  tighten,
  type AssetGenerateArgs,
  type AssetRegistration,
} from "@aivn/agent";
import type { PreloadAssetAttrs, SpriteFraming, SpriteStature } from "@aivn/core";
import type { KeyBackgroundColor } from "@aivn/agent";
import type { PlayAssets } from "../playAssets.js";
import { toPi } from "./schema.js";
import { linesResult, reason, textResult } from "./result.js";

/**
 * `generate_asset`：出一张剧目素材并**一步落成**（出图 +（立绘）抠底 + 登记）。
 *
 * 同一个能力（`asset.generate` 宏），两种投递由 face 决定——生命周期不进 schema：
 *
 * | | 工坊（sync） | 剧作家（queued） |
 * | --- | --- | --- |
 * | 等待 | await，回执带最终路径与预览 | 发起即返回，宿主到货广播并直落 `assets/` |
 * | 立绘 | 出候选 → `cut` → 登记透明 PNG | 后台排产（`emitPreload` 占住时间线，到货淡入） |
 *
 * 参数真相源与描述正文在 `@aivn/agent` 的 `asset.generate`；这里只声明服务端的 face
 *（pi 的长度收紧）与两种投递的回执。
 */
const FACE = tighten(assetGenerateFields, {
  name: { maxLength: 40 },
  spriteId: { maxLength: 40 },
  variant: { maxLength: 40 },
  references: { minItems: 1, maxItems: 6 },
  title: { maxLength: 40 },
  keyColor: {},
  description: { maxLength: 300 },
  style: { maxLength: 200 },
  prompt: { minLength: 1, maxLength: 4000 },
});

const generateAssetParams = toPi(FACE);

/** 参数类型由能力的 fields 反推；运行期校验由上面编译出来的 TypeBox 承担。 */
type AssetArgs = AssetGenerateArgs;

export interface SyncAssetDeps {
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
export interface QueuedAssetDeps {
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
  existingAssetUrl: (target: { kind: "background" | "cg" | "sprite"; name?: string; spriteId?: string; variant?: string }) => Promise<string | null>;
}

export type AssetToolDeps = SyncAssetDeps | QueuedAssetDeps;

const QUEUED_NOTE = [
  "",
  "**后台排产**：发起即返回，图到货（约一分多钟）自动淡入；这一轮就引用它，舞台先上骨架占位，",
  "照常写台词/旁白，不用为了等图停下来。回执会告诉你剧目里是不是已经有同名素材——有就直接引用。",
].join("\n");

const SYNC_NOTE = [
  "",
  "**同步等图**：这一轮停在这儿，出完才回。回执给最终路径与预览，这一轮就能在剧本里引用它。",
  "要精细控制（先出候选让用户挑、用外部图、单独重抠）就用原子三件套 `generate_image` / `cut` / `import_asset`。",
].join("\n");

export function createGenerateAssetTool(deps: AssetToolDeps): AgentTool<typeof generateAssetParams> {
  return {
    name: "generate_asset",
    label: "生成剧目素材",
    description: `${assetGenerate.doc}${deps.mode === "queued" ? QUEUED_NOTE : SYNC_NOTE}`,
    parameters: generateAssetParams,
    execute: async (toolCallId, params: Static<typeof generateAssetParams>) => {
      if (!deps.playAssets) {
        return textResult(
          deps.mode === "queued"
            ? "生图未启用（STAGE_IMAGE_ENABLED=false 或后端缺凭据）：别在剧本里引用没见过的素材 id，用旁白/台词交代。"
            : "生图未启用（STAGE_IMAGE_ENABLED=false 或后端缺凭据）：把该出的图列给用户，让用户在素材页上传。",
        );
      }
      try {
        const args = params as AssetArgs;
        return deps.mode === "sync" ? await runSync(deps, args, toolCallId) : await runQueued(deps, args);
      } catch (error) {
        return textResult(`生图失败：${reason(error)}`);
      }
    },
  };
}

/** 工坊：走包内宏（出候选 → 抠底 → 登记），回执给最终素材。 */
async function runSync(
  deps: SyncAssetDeps,
  params: AssetArgs,
  toolCallId: string,
): Promise<ReturnType<typeof linesResult>> {
  const assets = deps.playAssets!;
  let url = "";
  const out = await assetGenerate.execute(params as AssetGenerateArgs, {
    exists: (location) => assets.exists(location),
    produce: {
      async run(request) {
        const draft = await assets.draft(
          {
            kind: request.target!.kind,
            name: request.target!.name,
            spriteId: request.target!.spriteId,
            variant: request.target!.variant,
            framing: request.target!.framing,
            stature: request.target!.stature,
            title: request.target!.title,
            keyColor: request.target!.keyColor,
            references: request.references,
          },
          request.prompt,
          request.style,
        );
        url = draft.url;
        return { path: draft.path, adopted: false };
      },
    },
    // 服务端立绘入库（PlayAssets.register）自带去底、画布归一化、指标入表与原片留底（spriteIngest 收口），
    // 不传 cut，免去重复读盘。
    register: async (source, location, extra): Promise<AssetRegistration> => {
      const asset = await assets.register(source, location, extra);
      url = asset.url;
      return {
        kind: location.kind,
        path: asset.path,
        replaced: asset.replaced,
        ...(asset.sourcePath ? { sourcePath: asset.sourcePath } : {}),
      };
    },
  });

  const label = out.target.kind === "sprite" ? "立绘" : out.target.kind === "background" ? "背景" : "插图";
  if (out.skipped) return textResult(`剧目里已经有同名${label}，跳过生成——直接引用即可，别重复发起。`);
  const asset = out.registration!;
  deps.onAsset(asset.path, url, asset.kind, asset.replaced, toolCallId);
  return linesResult([
    `${label}已生成并入库：\`${asset.path}\`${asset.replaced ? "（覆盖了同名旧素材）" : ""}`,
    `![${asset.kind}](${url})`,
    "这一轮就能在剧本里引用它。",
  ]);
}

/** 剧作家：占住时间线上的位置后立刻返回，不等图（到货由宿主广播并直落 `assets/`）。 */
async function runQueued(deps: QueuedAssetDeps, params: AssetArgs): Promise<ReturnType<typeof textResult>> {
  const assets = deps.playAssets!;
  const references = resolveImageRefs(params as { references?: readonly string[] });
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
