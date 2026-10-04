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
import type { WebImageFetcher } from "../webImage.js";
import type { AssetTarget, PlayAssets } from "../playAssets.js";
import type { PlayFiles } from "../playFiles.js";
import type { PlaySaves } from "../saves.js";
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
 * 模型交出的停止点（beat_done 的参数）。
 * 与 `StopPayload` 的区别：没有 "pause"——那是编排器自己造的（空轮重试入口、分岔截断），模型写不出来。
 */
export type ModelStop = { stopType: StopType; options?: StopOption[]; placeholder?: string };

/**
 * 一次剧目文件写盘。**两个 agent 共用**：工坊拿它在对话流里内联展示（可撤销），
 * 剧作家拿它认角色卡、排轮边界重建——写的是同一批文件、同一条白名单。
 */
export interface PlayFileWrite {
  path: string;
  /** 写盘前的内容（撤销用；文件原本不存在则为 null）。 */
  before: string | null;
  after: string;
}

export interface KitCommonDeps {
  role: AgentRole;
  playId: string;
  /** 启用的能力 id（play.json 的 `agents.<role>.capabilities`；缺省 = 该角色的默认集，见 kit.ts）。 */
  capabilities: ReadonlySet<string>;
  /** 剧目目录：素材类工具要往这里写。 */
  store: PlayStore;
  /** 应用级素材资源库（只读检索 + 导入）。未配置时不注册 list_library / import_asset。 */
  assetLibrary?: AssetLibrary;
  /** Fish Audio 公共音色库客户端。未配置 TTS 时为 undefined，不注册 list_voices。 */
  voices?: VoiceCatalogService;
}

/** 剧作家侧：演出进行中，工具要动的是引擎状态、记忆与舞台事件流。 */
export interface PlaywriterKitDeps extends KitCommonDeps {
  role: "playwriter";
  engine: EngineStateSnapshot;
  /**
   * 角色 id 集合（来自角色卡目录）：update_state 的好感度按它做成员校验。
   * 纪元内只增不减——剧作家同轮写下 characters/<id>.md 后由写盘回调 add，新角色当轮就能写好感。
   */
  characterIds: ReadonlySet<string>;
  memory: PlayMemory;
  tree: LineageTree;
  /** 引擎状态真值在这里，update_state 的 scene/threads 直接改它（谱系级，随快照走）。 */
  stateFiles: Record<string, string>;
  /** 当前分支已走过的纪元（分岔回旧分支不得读到后世的章节摘要）。 */
  arcIds: () => readonly string[];
  /** 剧目文件层：read / write / edit 的白名单与落盘收口，与工坊**同一份**。 */
  files: PlayFiles;
  /**
   * 写盘回调（落盘之后触发，`PlayEnv.writeFile` 调用）。
   * 角色卡 id 登记、轮边界重建这类领域动作由宿主接在这里——文件工具本身不知道这些。
   */
  onWrite: (write: PlayFileWrite) => void;
  /** 停止点载荷 → IR 事件（加 seq → 广播 → 落谱系，与解析器产出的事件同一条管道）。 */
  emitStop: (stop: ModelStop) => void;
  /** 生图预发射 → IR 事件（骨架占位出现在时间线上那个位置）。 */
  emitPreload: (attrs: PreloadAssetAttrs) => void;
  /** 静态素材层（assets/，进 git）：立绘、背景、CG 都走它。未启用生图时为 undefined。 */
  playAssets?: PlayAssets;
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
  /** 写盘回调：推给前端（可见/可撤销），不阻塞 agent。 */
  onWrite: (write: PlayFileWrite) => void;
  /** 素材落盘回调：推给前端挂到产出它的那次工具调用上（调用号见工具 execute 入参）。 */
  onAsset: (asset: WorkshopAssetView, replaced?: boolean, toolCallId?: string) => void;
  /** 素材生成层（生图未启用时为 undefined，工具直接回不可用）。 */
  playAssets?: PlayAssets;
  /** 周目（存档）枚举——读故事树前先让 agent 知道有哪几棵。 */
  saves: PlaySaves;
  /** 按 saveId 取存档级操作面（会话面），供 read_lineage 读树。 */
  saveStore: (saveId: string) => PlayStore;
  /** 应用级素材资源库（只读浏览 + 导入）。未配置时不注册这两个工具。 */
  assetLibrary?: AssetLibrary;
  /** 联网检索（未配置 key 时为 undefined：工具不注册，prompt 里也不提联网）。 */
  exa?: Exa;
  /** 网络图下载（`view_image` 的网址分支）。没有它工具只认本地路径。 */
  webImage?: WebImageFetcher;
}

export type AgentKitDeps = PlaywriterKitDeps | WorkshopKitDeps;
