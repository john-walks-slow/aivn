import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import {
  LineageTree,
  type EngineStateSnapshot,
  type LineageEvent,
  type LineageStore,
} from "@stage-ai/core";
import { parsePlayConfig, type PlayConfig } from "./play.js";
import type { OrchestratorRuntimeState } from "./orchestrator.js";

/** 就绪门细项（D13）：开演前置检查。 */
export interface Readiness {
  ready: boolean;
  premise: boolean;
  /** ≥1 角色卡含立绘映射且差分文件存在。 */
  characterSprites: boolean;
  /** ≥1 背景图。 */
  background: boolean;
  hasSession: boolean;
}

export interface PlaySummary {
  id: string;
  title: string;
  premise: string;
  readiness: Readiness;
}

/** 剧目目录持久化：play.json + lineage.jsonl（append-only）+ session.json（快照/leaf/engine）。 */
export class PlayStore {
  private readonly dir: string;
  private jsonlReady = false;

  constructor(playDir: string) {
    this.dir = playDir;
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
    try {
      const raw = JSON.parse(await readFile(join(this.dir, "session.json"), "utf8"));
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

  /** 行级事件追加（JSONL append-only）。 */
  async appendEvent(event: LineageEvent): Promise<void> {
    if (!this.jsonlReady) {
      await mkdir(this.dir, { recursive: true });
      this.jsonlReady = true;
    }
    await appendFile(join(this.dir, "lineage.jsonl"), JSON.stringify(event) + "\n");
  }

  /** 会话全量（beat 收束时写；谱系树 + 引擎状态 + 场景 + 编排器运行态）。 */
  async saveSession(
    tree: LineageTree,
    engine: EngineStateSnapshot,
    scene: string,
    runtime?: OrchestratorRuntimeState,
  ): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    this.jsonlReady = true;
    const payload = {
      version: 1,
      lineage: tree.export(),
      engine,
      scene,
      runtime,
      savedAt: Date.now(),
    };
    await writeFile(join(this.dir, "session.json"), JSON.stringify(payload));
  }

  /** 清会话（「开始游戏」重开时）。 */
  async resetSession(): Promise<void> {
    this.jsonlReady = false;
    await rm(join(this.dir, "session.json"), { force: true });
    await rm(join(this.dir, "lineage.jsonl"), { force: true });
  }

  /** 就绪门检查（D13）：premise + 角色立绘映射 + ≥1 背景。 */
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
    const hasSession = existsSync(join(this.dir, "session.json"));
    return {
      ready: play.premise.trim() !== "" && characterSprites && background,
      premise: play.premise.trim() !== "",
      characterSprites,
      background,
      hasSession,
    };
  }

  /** 素材绝对路径（静态服务；kindPath 已白名单校验，如 "sprites/mio/neutral.png"）。 */
  assetPath(kindPath: string): string {
    return join(this.dir, "assets", ...kindPath.split("/"));
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
          out[`sprites/${char.name}`] = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
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

  store(playId: string): PlayStore {
    if (!/^[\w-]+$/.test(playId)) throw new Error(`非法剧目 id: ${playId}`);
    return new PlayStore(join(this.root, playId));
  }

  async list(): Promise<PlaySummary[]> {
    if (!existsSync(this.root)) return [];
    const summaries: PlaySummary[] = [];
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !existsSync(join(this.root, entry.name, "play.json"))) continue;
      const store = this.store(entry.name);
      const play = await store.loadPlay();
      summaries.push({
        id: play.id,
        title: play.title,
        premise: play.premise,
        readiness: await store.readiness(),
      });
    }
    return summaries;
  }

  /** 剧目包导入（zip：根层须含 play.json）。返回剧目 id。 */
  async importZip(data: Buffer): Promise<string> {
    const files = unzipSync(new Uint8Array(data));
    const prefix = Object.keys(files).find((name) => name.endsWith("play.json"));
    if (!prefix) throw new Error("剧目包缺少 play.json");
    const baseDir = prefix.slice(0, prefix.indexOf("play.json"));
    const playRaw = JSON.parse(new TextDecoder().decode(files[prefix]!));
    const play = parsePlayConfig(playRaw);
    const target = join(this.root, play.id);
    if (existsSync(target)) throw new Error(`剧目已存在: ${play.id}`);
    await mkdir(target, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      if (!name.startsWith(baseDir)) continue;
      const rel = name.slice(baseDir.length);
      if (rel === "" || rel.endsWith("/")) continue;
      const dest = join(target, rel);
      await mkdir(join(dest, ".."), { recursive: true });
      await writeFile(dest, content);
    }
    return play.id;
  }

  /** 剧目包导出（zip：play.json + assets，不含会话/记忆运行时）。 */
  async exportZip(playId: string): Promise<Uint8Array> {
    const dir = join(this.root, playId);
    const files: Record<string, Uint8Array> = {};
    const walk = async (rel: string): Promise<void> => {
      const abs = join(dir, rel);
      for (const entry of await readdir(abs, { withFileTypes: true })) {
        if (["sessions", "media-cache", "node_modules"].includes(entry.name)) continue;
        if (entry.name === "session.json" || entry.name === "lineage.jsonl") continue;
        const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) await walk(childRel);
        else files[childRel] = new Uint8Array(await readFile(join(dir, childRel)));
      }
    };
    await walk("");
    return zipSync(files, { level: 6 });
  }

  /** 新建空剧目（剧目库「新建」脚手架）。 */
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
          premise: "（空剧目：请在素材与配置中补全 premise 与角色卡）",
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
}
