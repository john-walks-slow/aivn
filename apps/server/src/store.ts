import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { unzipSync, zipSync } from "fflate";
import {
  LineageTree,
  type EngineStateSnapshot,
  type LineageEvent,
  type LineageStore,
} from "@stage-ai/core";
import { parsePlayConfig, type PlayConfig } from "@stage-ai/core";
import type { OrchestratorRuntimeState } from "./orchestrator.js";
import { parseHistory, type HistoryBeat } from "./history.js";
import { hasAnySave, readSaveMeta, saveDirOf, writeSaveMeta, assertSaveId, PlaySaves, type SaveMeta } from "./saves.js";

/** 周目列表卡的「最后一句」只认这三种带正文的行。 */
const PREVIEW_KINDS: ReadonlySet<string> = new Set(["say", "narrate", "thought"]);

/** 就绪门细项（D13）：开演前置检查。 */
export interface Readiness {
  ready: boolean;
  premise: boolean;
  /** ≥1 角色卡含立绘映射且差分文件存在。 */
  characterSprites: boolean;
  /** ≥1 背景图。 */
  background: boolean;
  /** 本剧目已有存档（「继续」入口的显隐）。 */
  hasSession: boolean;
}

export interface PlaySummary {
  id: string;
  title: string;
  premise: string;
  readiness: Readiness;
}

/** 剧目目录持久化：play.json / 素材 / 剧目级记忆；谱系与引擎状态按存档隔离在 saves/<saveId>/。 */
export class PlayStore {
  /** 剧目目录绝对路径（工坊文件层等外部模块需要根）。 */
  readonly dir: string;
  /** 当前存档（null = 剧目级操作面，没有会话作用域）。 */
  readonly saveId: string | null;
  private jsonlReady = false;

  constructor(playDir: string, saveId: string | null = null) {
    this.dir = playDir;
    this.saveId = saveId;
  }

  /** 存档目录（无 saveId 时抛错——会话面必须落在某一棵树上）。 */
  private sessionDir(): string {
    if (!this.saveId) throw new Error("该 PlayStore 无存档作用域");
    return saveDirOf(this.dir, this.saveId);
  }

  async loadPlay(): Promise<PlayConfig> {
    const raw = JSON.parse(await readFile(join(this.dir, "play.json"), "utf8"));
    return parsePlayConfig(raw);
  }

  async loadSession(): Promise<{
    store: LineageStore;
    engine: EngineStateSnapshot;
    scene: string;
    runtime?: OrchestratorRuntimeState;
  } | null> {
    if (!this.saveId) return null;
    try {
      const raw = JSON.parse(await readFile(join(this.sessionDir(), "session.json"), "utf8"));
      return {
        store: raw.lineage,
        engine: raw.engine,
        scene: raw.scene ?? "未定",
        runtime: raw.runtime,
      };
    } catch {
      return null;
    }
  }

  /**
   * 剧作家 session 历史（session.json 的 history 键）：思考 / 原始 DSL / 工具调用。
   * 无存档作用域、文件缺失、JSON 坏了、字段结构不对——一律空表：这是只读视图，不该把调用方拖挂。
   */
  async loadHistory(): Promise<HistoryBeat[]> {
    if (!this.saveId) return [];
    try {
      const raw = JSON.parse(await readFile(join(this.sessionDir(), "session.json"), "utf8"));
      return parseHistory(raw?.history);
    } catch {
      return [];
    }
  }

  /** 行级事件追加（JSONL append-only）。 */
  async appendEvent(event: LineageEvent): Promise<void> {
    const dir = this.sessionDir();
    if (!this.jsonlReady) {
      await mkdir(dir, { recursive: true });
      this.jsonlReady = true;
    }
    await appendFile(join(dir, "lineage.jsonl"), JSON.stringify(event) + "\n");
  }

  /**
   * 会话全量（beat 收束时写；谱系树 + 引擎状态 + 场景 + 编排器运行态 + 剧作家历史）。
   * 顺带更新档元信息（拍数 / 最后一句），让周目列表不必读会话文件。
   */
  async saveSession(
    tree: LineageTree,
    engine: EngineStateSnapshot,
    scene: string,
    runtime?: OrchestratorRuntimeState,
    history?: HistoryBeat[],
  ): Promise<void> {
    const dir = this.sessionDir();
    await mkdir(dir, { recursive: true });
    this.jsonlReady = true;
    const payload = {
      version: 1,
      lineage: tree.export(),
      engine,
      scene,
      runtime,
      history: history ?? [],
      savedAt: Date.now(),
    };
    await writeFile(join(dir, "session.json"), JSON.stringify(payload));
    await this.touchMeta(tree);
  }

  /** 落盘后回写档元信息：拍数与最后一句沿当前路径算，与列表卡显示同源。 */
  private async touchMeta(tree: LineageTree): Promise<void> {
    if (!this.saveId) return;
    const chain = tree.chainEvents(tree.leafId);
    let beats = 0;
    let preview = "";
    for (const event of chain) {
      if (event.kind === "beat_end") beats += 1;
      else if (PREVIEW_KINDS.has(event.kind) && event.text) preview = event.text;
    }
    const previous = (await readSaveMeta(this.dir, this.saveId)) ?? null;
    const meta: SaveMeta = {
      id: this.saveId,
      name: previous?.name ?? this.saveId,
      createdAt: previous?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      beats,
      preview: preview.slice(0, 40),
    };
    await writeSaveMeta(this.dir, meta);
  }

  /**
   * 就绪门检查：**只卡 premise**——图全可选。
   * 背景与立绘是建议项：没有图照样开演（舞台落氛围底色、没有立绘的角色不上台），
   * 演出不等素材，设定能边演边补。`characterSprites` / `background` 仍返回，
   * 素材页与工坊拿它做补齐建议。
   */
  async readiness(): Promise<Readiness> {
    let play: PlayConfig | null = null;
    try {
      play = await this.loadPlay();
    } catch {
      return { ready: false, premise: false, characterSprites: false, background: false, hasSession: false };
    }
    const spritesDir = join(this.dir, "assets/sprites");
    const characterSprites =
      play.characters.some((c) => {
        if (!c.sprites || Object.keys(c.sprites).length === 0) return false;
        return Object.values(c.sprites).every((file) => existsSync(join(spritesDir, c.id, file)));
      }) ?? false;
    const bgDir = join(this.dir, "assets/backgrounds");
    const background = existsSync(bgDir) && (await readdir(bgDir)).some((f) => /\.(png|jpe?g|webp)$/i.test(f));
    const hasSession = await hasAnySave(this.dir);
    // premise 有两个来源：play.json 与记忆卡。playwriter 取的是 memory.premise || play.premise，
    // 就绪门只看前者的话，工坊只写记忆卡就会一直红着而剧作家其实已经在用新前提。
    const memoryPremise = this.memoryDir("always", "premise.md");
    const premise =
      play.premise.trim() !== "" ||
      (existsSync(memoryPremise) && (await readFile(memoryPremise, "utf8")).trim() !== "");
    return {
      ready: premise,
      premise,
      characterSprites,
      background,
      hasSession,
    };
  }

  /** 素材绝对路径（静态服务；kindPath 已白名单校验，如 "sprites/mio/neutral.png"）。 */
  assetPath(kindPath: string): string {
    return join(this.dir, "assets", ...kindPath.split("/"));
  }

  /** TTS 音频缓存目录（media-cache/tts，运行时不进 git）。 */
  mediaDir(): string {
    return join(this.dir, "media-cache", "tts");
  }

  /** 剧目记忆目录（D7：always/index 剧目级进 git；index/arcs 与 archive 运行时不进）。 */
  memoryDir(...segments: string[]): string {
    return join(this.dir, "memory", ...segments);
  }

  /** TTS 音频绝对路径（静态服务；file 已白名单校验）。 */
  mediaPath(file: string): string {
    return join(this.dir, "media-cache", "tts", file);
  }

  /** 生图缓存目录（media-cache/img，运行时不进 git；内容寻址，同 prompt 只生成一次）。 */
  imageDir(): string {
    return join(this.dir, "media-cache", "img");
  }

  /** 生图产物绝对路径（静态服务；file 只由内容哈希产生，白名单式安全）。 */
  imagePath(file: string): string {
    return join(this.dir, "media-cache", "img", file);
  }

  /** 素材写入（上传）。kind ∈ sprites/<charId> | backgrounds | cg | sfx | bgm。 */
  async writeAsset(kindPath: string, name: string, data: Buffer): Promise<void> {
    const target = join(this.dir, "assets", kindPath, name);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, data);
  }

  /** 素材删除（素材管理页）。 */
  async deleteAsset(kindPath: string, name: string): Promise<void> {
    await rm(join(this.dir, "assets", kindPath, name), { force: true });
  }

  /** 素材描述表：assets/manifest.json 的 stem → 画面说明。没有或损坏即空表，不报错。 */
  async assetNotes(): Promise<Record<string, string>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.dir, "assets", "manifest.json"), "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const out: Record<string, string> = {};
      for (const [stem, note] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof note === "string" && note.trim()) out[stem] = note.trim();
      }
      return out;
    } catch {
      return {};
    }
  }

  /** play.json 全量保存（素材与配置页编辑）。 */
  async savePlay(play: PlayConfig): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, "play.json"), JSON.stringify(play, null, 2));
  }

  /** 列出素材树（素材管理页）。 */
  async listAssets(): Promise<Record<string, string[]>> {
    const root = join(this.dir, "assets");
    const out: Record<string, string[]> = {};
    if (!existsSync(root)) return out;
    for (const kind of ["backgrounds", "cg", "sprites", "sfx", "bgm"]) {
      const kindDir = join(root, kind);
      if (!existsSync(kindDir)) continue;
      if (kind === "sprites") {
        for (const char of await readdir(kindDir, { withFileTypes: true })) {
          if (!char.isDirectory()) continue;
          const files = await readdir(join(kindDir, char.name));
          // 排序：编排器在找不到指定差分时取 files[0] 兜底，readdir 顺序不定会让兜底每次挑到不同的脸
          out[`sprites/${char.name}`] = files
            .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
            .sort((a, b) => a.localeCompare(b));
        }
      } else {
        out[kind] = (await readdir(kindDir)).filter((f) => /\.(png|jpe?g|webp|mp3|ogg|wav|m4a)$/i.test(f));
      }
    }
    return out;
  }
}

/** 剧目库（plays/ 根）：列表/导入/导出。 */
export class PlayLibrary {
  constructor(private readonly root: string) {}

  private dirOf(playId: string): string {
    if (!/^[\w-]+$/.test(playId)) throw new Error(`非法剧目 id: ${playId}`);
    return join(this.root, playId);
  }

  /** 剧目级操作面（play.json / 素材 / 记忆 / 工坊文件）：无会话作用域。 */
  store(playId: string): PlayStore {
    return new PlayStore(this.dirOf(playId));
  }

  /** 存档级操作面：会话读写落在 saves/<saveId>/。 */
  saveStore(playId: string, saveId: string): PlayStore {
    return new PlayStore(this.dirOf(playId), assertSaveId(saveId));
  }

  /** 存档（周目）管理面。 */
  saves(playId: string): PlaySaves {
    return new PlaySaves(this.dirOf(playId));
  }

  async list(): Promise<PlaySummary[]> {
    if (!existsSync(this.root)) return [];
    const summaries: PlaySummary[] = [];
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !existsSync(join(this.root, entry.name, "play.json"))) continue;
      try {
        const store = this.store(entry.name);
        const play = await store.loadPlay();
        summaries.push({
          id: play.id,
          title: play.title,
          premise: play.premise,
          readiness: await store.readiness(),
        });
      } catch {
        // 单剧目损坏/校验不过不拖垮整个列表，跳过
      }
    }
    return summaries;
  }

  /** 剧目包导入（zip：根层须含 play.json）。返回剧目 id。防 Zip Slip：先全量校验再落盘，杜绝部分导入残留。 */
  async importZip(data: Buffer): Promise<string> {
    const files = unzipSync(new Uint8Array(data));
    const prefix = Object.keys(files).find((name) => name.endsWith("play.json"));
    if (!prefix) throw new Error("剧目包缺少 play.json");
    const baseDir = prefix.slice(0, prefix.indexOf("play.json"));
    const playRaw = JSON.parse(new TextDecoder().decode(files[prefix]!));
    const play = parsePlayConfig(playRaw);
    if (!/^[\w-]+$/.test(play.id)) throw new Error(`非法剧目 id: ${play.id}`);
    const target = join(this.root, play.id);
    if (existsSync(target)) throw new Error(`剧目已存在: ${play.id}`);
    const targetAbs = resolve(target);
    const entries: { rel: string; content: Uint8Array }[] = [];
    for (const [name, content] of Object.entries(files)) {
      if (!name.startsWith(baseDir)) continue;
      const rel = name.slice(baseDir.length);
      if (rel === "" || rel.endsWith("/")) continue;
      const dest = resolve(target, rel);
      if (dest !== targetAbs && !dest.startsWith(targetAbs + sep)) {
        throw new Error(`剧目包含非法路径: ${name}`);
      }
      entries.push({ rel, content });
    }
    await mkdir(target, { recursive: true });
    for (const { rel, content } of entries) {
      await mkdir(join(target, rel, ".."), { recursive: true });
      await writeFile(join(target, rel), content);
    }
    return play.id;
  }

  /** 剧目包导出（zip：play.json + assets + 剧目级记忆，不含存档/媒体缓存等运行时）。 */
  async exportZip(playId: string): Promise<Uint8Array> {
    const dir = this.dirOf(playId);
    const files: Record<string, Uint8Array> = {};
    const walk = async (rel: string): Promise<void> => {
      const abs = join(dir, rel);
      for (const entry of await readdir(abs, { withFileTypes: true })) {
        // 存档（saves/）与活动档指针是玩家进度，不随剧目包走
        if (["saves", "media-cache", "node_modules"].includes(entry.name)) continue;
        if (entry.name === "active.json") continue;
        const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) await walk(childRel);
        else files[childRel] = new Uint8Array(await readFile(join(dir, childRel)));
      }
    };
    await walk("");
    return zipSync(files, { level: 6 });
  }

  /** 新建空剧目（剧目库「新建」脚手架）。premise 留空——就绪门会把它列为缺项。 */
  async createEmpty(playId: string, title: string): Promise<void> {
    const dir = join(this.root, playId);
    if (existsSync(join(dir, "play.json"))) throw new Error(`剧目已存在: ${playId}`);
    await mkdir(join(dir, "assets", "backgrounds"), { recursive: true });
    await mkdir(join(dir, "assets", "sprites"), { recursive: true });
    await writeFile(
      join(dir, "play.json"),
      JSON.stringify(
        {
          id: playId,
          title,
          premise: "",
          characters: [],
          opening: "（游戏开始，请演出第一幕的开幕）",
          initialState: { turn: 0, affinity: {}, flags: {} },
          initialScene: "未定",
        },
        null,
        2,
      ),
    );
  }

  /** 删除剧目（整目录：play.json/素材/会话，不可恢复；调用方先停 runtime）。 */
  async remove(playId: string): Promise<void> {
    if (!/^[\w-]+$/.test(playId)) throw new Error(`非法剧目 id: ${playId}`);
    await rm(join(this.root, playId), { recursive: true, force: true });
  }
}
