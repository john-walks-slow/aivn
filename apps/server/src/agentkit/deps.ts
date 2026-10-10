import type {
  EngineStateSnapshot,
  LineageTree,
  PreloadAssetAttrs,
  SpriteFraming,
  SpriteStature,
  StopOption,
  StopType,
} from "@aivn/core";
import type { AssetLibrary } from "../library.js";
import type { VoiceCatalogService } from "../voiceCatalog.js";
import type { Exa } from "../exa.js";
import type { AssetTarget, PlayAssets } from "../playAssets.js";
import type { GenerateMusicRequest, PlayMusic } from "../playMusic.js";
import type { PlayFiles } from "../playFiles.js";
import type { PlayStore } from "../store.js";
import type { PlayMemory } from "../memory.js";
import type { WorkshopAssetView } from "@aivn/core";
import type { AgentRole } from "./role.js";

/**
 * 统一基座的依赖面：按角色收窄的判别联合。
 *
 * 同一个工具在两个角色下共用实现与 schema，差别只有「描述 + 等待策略 + 传进来的依赖」——
 * 所以依赖必须能被 role 区分开，装配器才有地方分叉，工具自己不必到处 if role。
 */

/**
 * 一次剧目文件写盘。**两个 agent 共用**：工坊拿它推刷新信号（各页重拉），
 * 剧作家拿它认角色卡、排轮边界重建——写的是同一批文件、同一条白名单。
 */
export interface PlayFileWrite {
  path: string;
}

export interface KitCommonDeps {
  role: AgentRole;
  playId: string;
  /** 启用的能力 id（play.json 的 `agents.<role>.capabilities`；缺省 = 该角色的默认集，见 kit.ts）。 */
  capabilities: ReadonlySet<string>;
  /** 剧目目录：素材类工具要往这里写。 */
  store: PlayStore;
  /** 应用级素材资源库（只读检索 + `import_asset` 的 `library:` 来源）。未配置时不注册 list_library，也不认那种来源。 */
  assetLibrary?: AssetLibrary;
  /** Fish Audio 公共音色库客户端。未配置 TTS 时为 undefined，不注册 list_voices。 */
  voices?: VoiceCatalogService;
  /**
   * 出图并发上限（部署配置 `image.concurrency`）：只用来写进 `generate_image` 的描述。
   * 闸门本身在宿主的 `Limiter` 上，工具不自己限流——这里要让模型知道「一批一起发就会并发跑、
   * 同时最多几张」，否则它会一张一张等结果，把 6 路的闸门用成单路。
   */
  imageConcurrency?: number;
}

/** 剧作家侧：演出进行中，工具要动的是引擎状态、记忆与舞台事件流。 */
export interface PlaywriterKitDeps extends KitCommonDeps {
  role: "playwriter";
  engine: EngineStateSnapshot;
  memory: PlayMemory;
  tree: LineageTree;
  /** 剧目文件层：read / write / edit 的白名单与落盘收口，与工坊**同一份**。 */
  files: PlayFiles;
  /**
   * 写盘回调（落盘之后触发，`PlayEnv.writeFile` 调用）。
   * 角色卡 id 登记、轮边界重建这类领域动作由宿主接在这里——文件工具本身不知道这些。
   */
  onWrite: (write: PlayFileWrite) => void;
  /** 生图预发射 → IR 事件（骨架占位出现在时间线上那个位置）。 */
  emitPreload: (attrs: PreloadAssetAttrs) => void;
  /** 静态素材层（assets/，进 git）：立绘、背景、CG 都走它。未启用生图时为 undefined。 */
  playAssets?: PlayAssets;
  /** 音乐生成层（落 assets/bgm/）。未启用音乐生成时为 undefined。 */
  playMusic?: PlayMusic;
  /** 后台发起 bg/cg：宿主负责到货广播 asset_ready / 失败 asset_failed（工具不等图）。 */
  kick: (type: "bg" | "cg", prompt: string, id: string, references?: string[]) => void;
  /** 后台发起立绘：同上的失败广播。references 只在出 neutral 定妆照时有意义。 */
  kickSprite: (target: { spriteId: string; variant: string; prompt: string; framing?: SpriteFraming; stature?: SpriteStature; title?: string; references?: string[] }) => void;
  /** 这个目标在剧目里已有素材的静态 URL——有就不烧配额，直接引用。 */
  existingAssetUrl: (target: AssetTarget) => Promise<string | null>;
  /** 联网检索（未配置 key 时不注册，提示词也不提）。 */
  exa?: Exa;
  /** 请求进入限制级（NSFW）剧情。 */
  onEnterNsfw: (reason?: string) => void;
  /** 请求退出限制级（NSFW）剧情。 */
  onExitNsfw: (summary?: string) => void;
  /** 当前是否在限制级（NSFW）剧情中。 */
  isNsfw: () => boolean;
}

/** 工坊侧：搭台，工具动的是剧目文件、素材与故事树（只读）。 */
export interface WorkshopKitDeps extends KitCommonDeps {
  role: "workshop";
  files: PlayFiles;
  store: PlayStore;
  /** 写盘回调：推刷新信号（各页重拉），不阻塞 agent。 */
  onWrite: (write: PlayFileWrite) => void;
  /** 素材落盘回调：推给前端挂到产出它的那次工具调用上（调用号见工具 execute 入参）。 */
  onAsset: (asset: WorkshopAssetView, replaced?: boolean, toolCallId?: string) => void;
  /** 素材生成层（生图未启用时为 undefined，工具直接回不可用）。 */
  playAssets?: PlayAssets;
  /** 音乐生成层（音乐生成未启用时为 undefined，不注册 generate_bgm）。 */
  playMusic?: PlayMusic;
  /** 后台发起 BGM 生成（宿主记账与到货广播）。没配音乐后端时工具压根不注册。 */
  queueMusic?: (req: GenerateMusicRequest) => string;
  /** 应用级素材资源库（只读浏览 + 导入）。未配置时不注册这两个工具。 */
  assetLibrary?: AssetLibrary;
  /** 联网检索（未配置 key 时为 undefined：工具不注册，prompt 里也不提联网）。 */
  exa?: Exa;
}

export type AgentKitDeps = PlaywriterKitDeps | WorkshopKitDeps;
