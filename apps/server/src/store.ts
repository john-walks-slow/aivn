import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, sep, dirname } from "node:path";
import { unzipSync, zipSync } from "fflate";
import {
  LineageTree,
  type EngineStateSnapshot,
  type LineageEvent,
  type LineageStore,
} from "@stage-ai/core";
import { parsePlayConfig, parsePlayAssetManifest, type AssetMeta, type PlayConfig } from "@stage-ai/core";
import type { OrchestratorRuntimeState } from "./orchestrator.js";
import { parseHistory, type HistoryBeat } from "./history.js";
import { countSaves, readSaveMeta, saveDirOf, writeSaveMeta, assertSaveId, PlaySaves, type SaveMeta } from "./saves.js";

/** 周目列表卡的「最后一句」只认这三种带正文的行。 */
const PREVIEW_KINDS: ReadonlySet<string> = new Set(["say", "narrate", "thought"]);

/** 开演前置检查的细项：引擎手上还没有的东西（只作提示，不挡开演）。 */
export interface Readiness {
  premise: boolean;
  /** ≥1 角色卡含立绘映射且差分文件存在。 */
  characterSprites: boolean;
  /** ≥1 背景图。 */
  background: boolean;
  /** 本剧目已有的周目数（0 = 还没开演）。 */
  saves: number;
}

export interface PlaySummary {
  id: string;
  title: string;
  /** 一句话简介：取自 memory/always/premise.md（playwriter A 区注入的同一份）。 */
  premise: string;
  readiness: Readiness;
}

/** 出图台账的一条记录（assets/generated.json，引擎写、其余只读）。 */
export interface PlayLedgerEntry {
  /** 素材 id：背景/CG 用文件名主体，立绘用 `<角色id>/<差分名>`（与 prompt.ts 查表同一种键）。 */
  id: string;
  kind: "background" | "cg" | "sprite";
  /** 剧目内相对路径。文件是权威：图没了这条记录就不算数。 */
  path: string;
  /** 实际发给模型的 prompt 原文（含引擎拼的画风与构图后缀），原样留档。 */
  prompt: string;
  /** 记账时刻（ISO），给人看溯源用。 */
  at: string;
}

/**
 * 剧目配置文件的读改写互斥队列，按剧目目录绝对路径索引。
 *
 * `PlayLibrary.store()` 每次调用都 new 一个 PlayStore，拿对象身份当锁的 key 等于没锁
 * （每个 HTTP 请求各持一份，队列直接穿透）。目录路径才是同一剧目的真正身份。
 * 挂在 store.ts 而不是某个业务模块：play.json 与 assets/manifest.json 的写入方散在
 * http / workshop / playAssets / assetImport 四处，锁得由最底层的存储面来发。
 */
const configWrites = new Map<string, Promise<unknown>>();

/** 排队执行剧目配置的读改写；上一个写失败不传染给排队者，但调用方看得见自己这次失败。 */
export function withPlayConfigLock<T>(playDir: string, task: () => Promise<T>): Promise<T> {
  // 归一化：`plays/p1` 与 `plays/p1/` 必须共用一把锁，否则一个尾斜杠就能把队列劈成两条
  const key = resolve(playDir);
  const next = (configWrites.get(key) ?? Promise.resolve()).then(task);
  const tail = next.catch(() => {});
  configWrites.set(key, tail);
  // 收尾时只有自己还在队尾才删 key——后面排着别人的话留给它们删，免得锁提前失效
  void tail.finally(() => {
    if (configWrites.get(key) === tail) configWrites.delete(key);
  });
  return next;
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
   * 顺带更新档元信息（轮数 / 最后一句），让周目列表不必读会话文件。
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

  /** 落盘后回写档元信息：轮数与最后一句沿当前路径算，与列表卡显示同源。 */
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
   * 开演前置检查（只作提示，不挡开演）：没有故事前提照样能演，剧作家会自由发挥；
   * 没图也照样演，舞台落氛围底色、没有立绘的角色不上台。这些都只是「还没有什么」。
   */
  async readiness(): Promise<Readiness> {
    let play: PlayConfig | null = null;
    try {
      play = await this.loadPlay();
    } catch {
      return { premise: false, characterSprites: false, background: false, saves: 0 };
    }
    const spritesDir = join(this.dir, "assets/sprites");
    const characterSprites =
      play.characters.some((c) => {
        if (!c.sprites || Object.keys(c.sprites).length === 0) return false;
        return Object.values(c.sprites).every((file) => existsSync(join(spritesDir, c.id, file)));
      }) ?? false;
    const bgDir = join(this.dir, "assets/backgrounds");
    const background = existsSync(bgDir) && (await readdir(bgDir)).some((f) => /\.(png|jpe?g|webp)$/i.test(f));
    const saves = await countSaves(this.dir);
    // 世界观前提的唯一真相源：memory/always/premise.md。
    const premise = (await this.premise()).trim() !== "";
    return {
      premise,
      characterSprites,
      background,
      saves,
    };
  }

  /** 素材绝对路径（静态服务；kindPath 已白名单校验，如 "sprites/角色id/neutral.png"）。 */
  assetPath(kindPath: string): string {
    return join(this.dir, "assets", ...kindPath.split("/"));
  }

  /** TTS 音频缓存目录（media-cache/tts，按内容寻址可重建，运行时不进 git）。 */
  mediaDir(): string {
    return join(this.dir, "media-cache", "tts");
  }

  /** 剧目记忆目录（D7：always/index 剧目级进 git；arcs 与 archive 运行时不进）。 */
  memoryDir(...segments: string[]): string {
    return join(this.dir, "memory", ...segments);
  }

  /**
   * 立绘留底原片目录（media-cache/sprite-sources/<角色id>/）：抠底前那一张原片。
   * 只为原地重抠（`PlayAssets.recut`）留着，是跑批产物不是剧目内容，不进 git。
   */
  spriteSourceDir(...segments: string[]): string {
    return join(this.dir, "media-cache", "sprite-sources", ...segments);
  }

  /**
   * 世界观前提（memory/always/premise.md）：A 区注入、就绪门、剧目卡简介的唯一真相源。
   * 与 craft.md 同层——是纯内容不是引擎结构，所以不进 play.json。
   */
  async premise(): Promise<string> {
    const path = this.memoryDir("always", "premise.md");
    if (existsSync(path)) return readFile(path, "utf8");
    // 旧剧目的前提还躺在 play.json 里（字段已从契约删除，但文件是用户的数据）：
    // 只读回退，不自动搬——让用户看见原文再自己决定存到哪，别悄悄改别人的剧目文件
    const legacy = await this.legacyPremise();
    return legacy ?? "";
  }

  /** 旧版 play.json 的 premise 字段（parsePlayConfig 已不认识它，只能读原始 JSON）。 */
  private async legacyPremise(): Promise<string | null> {
    try {
      const raw = JSON.parse(await readFile(join(this.dir, "play.json"), "utf8")) as { premise?: unknown };
      return typeof raw.premise === "string" && raw.premise.trim() !== "" ? raw.premise : null;
    } catch {
      return null;
    }
  }

  /** 写世界观前提（用户与工坊共用一个入口）。走 config 锁：同目录的 play.json 可能正被别人改。 */
  async savePremise(text: string): Promise<void> {
    await withPlayConfigLock(this.dir, async () => {
      const path = this.memoryDir("always", "premise.md");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text, "utf8");
    });
  }

  /** TTS 音频绝对路径（静态服务；file 已白名单校验）。 */
  mediaPath(file: string): string {
    return join(this.dir, "media-cache", "tts", file);
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

  /**
   * 素材元数据表：assets/manifest.json 的 stem → 元数据。没有或损坏即空表，不报错。
   * 值可以是字符串（只有一句描述，旧格式）或对象——归一化在 core 的 parsePlayAssetManifest。
   */
  async assetMeta(): Promise<Record<string, AssetMeta>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.dir, "assets", "manifest.json"), "utf8"));
      return parsePlayAssetManifest(parsed);
    } catch {
      return {};
    }
  }

  /**
   * 出图台账：assets/generated.json 的 id → 记录。没有或损坏即空表。
   *
   * 与 manifest.json 分开有两个原因：**一张表一个写者**（manifest 是工坊与用户写的，
   * 记录出图 prompt 是引擎写的，实测两边都动同一张表时，工坊补一条描述就把引擎记的 prompt 整条冲掉了），
   * 以及**不该被改**——素材描述是人话、出图 prompt 是原样留档，混在一格里谁都能顺手改坏。
   * 这个文件工坊只读（assets/ 下除 manifest.json 外都不可写），进 git，跟着图走。
   */
  async ledger(): Promise<Record<string, PlayLedgerEntry>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.ledgerPath(), "utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      return parsed as Record<string, PlayLedgerEntry>;
    } catch {
      return {};
    }
  }

  /** 记一次出图（引擎专用）。同 id 覆盖：一张图只有最后一次出图的 prompt 有意义。 */
  async saveLedgerEntry(entry: PlayLedgerEntry): Promise<void> {
    const table = await this.ledger();
    await mkdir(join(this.dir, "assets"), { recursive: true });
    await writeFile(this.ledgerPath(), `${JSON.stringify({ ...table, [entry.id]: entry }, null, 2)}\n`);
  }

  private ledgerPath(): string {
    return join(this.dir, "assets", "generated.json");
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

/** 新剧目落盘：play.json + 两份最基础的设定文件。 */
const CRAFT_PATH = "memory/always/craft.md";
const PREMISE_PATH = "memory/always/premise.md";

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
          // 简介取自 A 区注入的同一份前提，剧目卡上看到的与剧作家读到的是同一句话
          premise: (await store.premise()).replace(/\s+/g, " ").trim().slice(0, 120),
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

  /** 新建空剧目（剧目库「新建」脚手架）。两份常驻设定建好但留空——
   *  建文件是为了它在设定页有一张卡可编辑，空文件才是「用户还没写」。
   *  模板正文一律不进 A 区：剧作家该读的是用户写的设定，不是我们的写作指引。 */
  async createEmpty(playId: string, title: string): Promise<void> {
    const dir = join(this.root, playId);
    if (existsSync(join(dir, "play.json"))) throw new Error(`剧目已存在: ${playId}`);
    await mkdir(join(dir, "assets", "backgrounds"), { recursive: true });
    await mkdir(join(dir, "assets", "sprites"), { recursive: true });
    await mkdir(join(dir, "memory", "always"), { recursive: true });
    await writeFile(
      join(dir, "play.json"),
      JSON.stringify(
        {
          id: playId,
          title,
          characters: [],
          opening: "（游戏开始，请演出第一轮）",
          initialState: { turn: 0, affinity: {}, flags: {} },
          initialScene: "未定",
        },
        null,
        2,
      ),
    );
    await writeFile(join(dir, PREMISE_PATH), "");
    await writeFile(join(dir, CRAFT_PATH), "");
  }

  /** 删除剧目（整目录：play.json/素材/会话，不可恢复；调用方先停 runtime）。 */
  async remove(playId: string): Promise<void> {
    if (!/^[\w-]+$/.test(playId)) throw new Error(`非法剧目 id: ${playId}`);
    await rm(join(this.root, playId), { recursive: true, force: true });
  }
}
