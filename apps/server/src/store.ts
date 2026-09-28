import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LineageTree,
  type EngineStateSnapshot,
  type LineageEvent,
  type LineageStore,
} from "@stage-ai/core";
import { parsePlayConfig, type PlayConfig } from "./play.js";

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

  async loadSession(): Promise<{ store: LineageStore; engine: EngineStateSnapshot; scene: string } | null> {
    try {
      const raw = JSON.parse(await readFile(join(this.dir, "session.json"), "utf8"));
      return { store: raw.lineage, engine: raw.engine, scene: raw.scene ?? "未定" };
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

  /** 会话全量（beat 收束时写；谱系树 + 引擎状态 + 场景）。 */
  async saveSession(tree: LineageTree, engine: EngineStateSnapshot, scene: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    this.jsonlReady = true;
    const payload = {
      version: 1,
      lineage: tree.export(),
      engine,
      scene,
      savedAt: Date.now(),
    };
    await writeFile(join(this.dir, "session.json"), JSON.stringify(payload, null, 2));
  }
}
