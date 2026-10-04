import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { AssetMeta, WorkshopAssetView } from "@aivn/core";
import type { MusicBackend } from "./musicBackend.js";
import { assertAssetStem } from "./playAssets.js";
import type { PlayFiles } from "./playFiles.js";
import { withPlayConfigLock, type PlayStore } from "./store.js";
import type { PlayFileWrite } from "./agentkit/deps.js";

/**
 * 剧目内的 BGM 落盘层：生成一首曲子，写进 `assets/bgm/`，并把**选取用的元数据**补进素材表。
 *
 * 与生图（`PlayAssets`）分开而不是塞进去：`PlayAssets` 的一整套形状——垫图、抠底、画幅档位、
 * 立绘差分基准——全是给图准备的，音乐一条都用不上，硬塞会让那个类同时管两件不相干的事。
 * 真正共享的那部分只有素材表的读-改-写锁（`withPlayConfigLock`），本来就是同一个函数。
 *
 * **元数据是这层存在的理由**：剧作家按描述/情绪/场景选曲（`list_library` 与素材表都走它），
 * 只丢一个音频文件进去，等于让它在几百条曲名里盲选。
 */

/** 音频扩展名白名单：与 `store.listAssets` 的过滤保持一致，否则素材页看不见刚生成的曲子。 */
const AUDIO_EXTS = new Set([".mp3", ".ogg", ".m4a", ".wav", ".flac"]);

export interface MusicAssetDeps {
  playId: string;
  store: PlayStore;
  files: PlayFiles;
  backend: MusicBackend;
  /** 素材声明补写要进撤销条（二进制本身不进）。 */
  onWrite: (write: PlayFileWrite) => void;
  /**
   * 素材到货（工坊侧挂到对话气泡里的音频播放器）。
   *
   * `toolCallId` 让工坊把播放器归位到 `generate_bgm` 那一次工具调用行上，而不是笼统挂在消息级。
   */
  onAsset?: (asset: WorkshopAssetView, replaced: boolean, toolCallId?: string) => void;
}

export interface GenerateMusicRequest {
  /** 素材 id：剧本里 `<scene bgm="id">` 引用的就是它。 */
  name: string;
  prompt: string;
  title?: string;
  description?: string;
  tags?: string[];
  mood?: string[];
  scene?: string[];
  /** 是否适合循环播放（剧目素材表的一格，也是选曲时的一维）。 */
  loop?: boolean;
  /** 建议默认音量（0–1）。不给按 0.4（垫底 BGM 的常规起点）。 */
  volume?: number;
  /**
   * 剧目覆盖的音乐模型名；不给用后端默认。
   *
   * 预留口子：`play.json` 的 `music.model` 尚未接进来（`parsePlayConfig` 会静默丢弃它），
   * 接通前恒为 undefined。
   */
  model?: string;
}

export interface GeneratedMusicAsset {
  id: string;
  /** 剧目内相对路径，如 `assets/bgm/haru_no_kyousitu.m4a`。 */
  path: string;
  url: string;
  /** 覆盖了同名素材。 */
  replaced: boolean;
}

export class PlayMusic {
  private readonly inflight = new Map<string, Promise<GeneratedMusicAsset>>();

  constructor(private readonly deps: MusicAssetDeps) {}

  /**
   * 同一目标在飞的那首合并成一次：模型在一个回合里并发调两次同名 id，
   * 两份生成各自烧配额、竞态写盘，覆盖标记也说不清。
   */
  async generate(req: GenerateMusicRequest, toolCallId?: string): Promise<GeneratedMusicAsset> {
    const id = assertAssetStem(req.name, "BGM 素材名");
    const running = this.inflight.get(id);
    if (running) return running;
    const task = this.run(id, req, toolCallId).finally(() => this.inflight.delete(id));
    this.inflight.set(id, task);
    return task;
  }

  private async run(id: string, req: GenerateMusicRequest, toolCallId?: string): Promise<GeneratedMusicAsset> {
    const music = await this.deps.backend.generate({ prompt: req.prompt, model: req.model });
    const kindPath = "bgm";
    const replaced = await this.removeStaleSiblings(kindPath, id);
    const rel = `assets/${kindPath}/${id}${music.ext}`;
    const abs = this.deps.store.assetPath(`${kindPath}/${id}${music.ext}`);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, music.bytes);
    const url = `/plays/${this.deps.playId}/${rel}`;
    this.deps.onAsset?.({ kind: "bgm", path: rel, url }, replaced, toolCallId);
    await this.declareMeta(id, req);
    return { id, path: rel, url, replaced };
  }

  /** 同一 stem 下别的扩展名要清掉：素材索引按 stem 认，留着旧的会挑到上一首。 */
  private async removeStaleSiblings(kindPath: string, stem: string): Promise<boolean> {
    const dir = this.deps.store.assetPath(kindPath);
    if (!existsSync(dir)) return false;
    let replaced = false;
    for (const name of await readdir(dir)) {
      const ext = extname(name).toLowerCase();
      if (!AUDIO_EXTS.has(ext) || name.slice(0, name.length - ext.length) !== stem) continue;
      await this.deps.store.deleteAsset(kindPath, name);
      replaced = true;
    }
    return replaced;
  }

  /**
   * 把选取用的元数据写进素材表（走与生图同一把剧目配置锁）。
   *
   * **描述归工坊与用户**：请求没带新描述就原样保留既有那句，这一层不主动抹；
   * 只有这一层确知的几格（标题、情绪、场景、可循环、时长、出处）才写。
   */
  private declareMeta(id: string, req: GenerateMusicRequest): Promise<void> {
    return withPlayConfigLock(this.deps.store.dir, async () => {
      const raw = await this.deps.files.read("assets/manifest.json").catch(() => "");
      const current: Record<string, unknown> =
        raw && raw.trim()
          ? (() => {
              try {
                const parsed: unknown = JSON.parse(raw);
                return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                  ? (parsed as Record<string, unknown>)
                  : {};
              } catch {
                return {};
              }
            })()
          : {};
      const prev = current[id];
      const meta: Record<string, unknown> =
        prev && typeof prev === "object" && !Array.isArray(prev)
          ? { ...(prev as Record<string, unknown>) }
          : typeof prev === "string"
            ? { description: prev }
            : {};
      if (req.title) meta.title = req.title;
      if (req.description) meta.description = req.description;
      if (req.tags?.length) meta.tags = req.tags;
      if (req.mood?.length) meta.mood = req.mood;
      if (req.scene?.length) meta.scene = req.scene;
      if (req.loop !== undefined) meta.loop = req.loop;
      // 音量默认只在没有过既有值时给：同名重生成不该把用户调过的 0.2 拨回 0.4
      if (req.volume !== undefined) meta.volume = req.volume;
      else if (typeof meta.volume !== "number") meta.volume = 0.4;
      // 出处是「站内生成」，与素材库里逐条抄来的许可信息同一栏，但这一栏写的是生成不是授权
      meta.source = "站内生成（音乐生成后端）";
      current[id] = meta satisfies AssetMeta;

      const after = `${JSON.stringify(current, null, 2)}\n`;
      if (after === raw) return;
      await this.deps.files.write("assets/manifest.json", after);
      this.deps.onWrite({ path: "assets/manifest.json", before: raw || null, after });
    });
  }
}