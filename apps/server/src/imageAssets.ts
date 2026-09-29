import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GeneratedAsset } from "@stage-ai/core";
import type { PlayStore } from "./store.js";
import type { ImageGen } from "./imagegen.js";

/**
 * 生图资产层（D6）：剧目级 manifest + 内容寻址缓存 + 并发闸门 + 在飞去重。
 * - 复用键 = sha1(type + prompt)：同描述不同 id 共用一张图，分岔/重演不重复烧配额；
 * - manifest 落 media-cache/img/manifest.json（id → 文件）：重连时 hello 直接带全集，
 *   资产不依赖「下一次预发射」才可见；文件缺失的条目跳过，磁盘是权威；
 * - 并发闸门：每图 15–30s，串行会把 3–5 句的预发射窗口拖穿，超出的请求排队。
 * 失败一律抛出由调用方降级（既有素材/氛围色），不留永久骨架。
 */

interface ManifestEntry {
  id: string;
  type: "bg" | "cg";
  file: string;
}

/** 排队上限：预发射是「锦上添花」，队列爆掉就直接失败降级，不无限吃内存。 */
const MAX_QUEUE = 12;

/** 复用键：同类型同描述 → 同一张文件（不同类型的同描述算两张资产）。 */
function fileName(type: "bg" | "cg", prompt: string): string {
  return `${createHash("sha1").update(type).update("\0").update(prompt).digest("hex")}.jpg`;
}

export class ImageAssets {
  private readonly byId = new Map<string, GeneratedAsset>();
  /** 同一 id 的在飞请求去重：preload 与引用它的 cg/scene 常在几拍内先后到达。 */
  private readonly inflight = new Map<string, Promise<GeneratedAsset>>();
  /** 同一张图（内容指纹）的在飞生成：不同 id 共用同描述时只出一次图。 */
  private readonly generating = new Map<string, Promise<void>>();
  private running = 0;
  private readonly queue: (() => void)[] = [];
  private dirty = false;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly playId: string,
    private readonly store: PlayStore,
    private readonly gen: ImageGen,
    private readonly concurrency: number,
  ) {}

  async load(): Promise<void> {
    let entries: unknown;
    try {
      entries = JSON.parse(await readFile(this.manifestPath(), "utf8"));
    } catch {
      return; // 首次运行或 manifest 损坏：文件在磁盘上还是权威，无从恢复即从零开始
    }
    if (!Array.isArray(entries)) return;
    for (const entry of entries as ManifestEntry[]) {
      if (!entry?.id || !entry.file) continue;
      if (!existsSync(this.store.imagePath(entry.file))) continue;
      this.byId.set(entry.id, {
        id: entry.id,
        type: entry.type === "cg" ? "cg" : "bg",
        url: `/plays/${this.playId}/media/img/${entry.file}`,
      });
    }
  }

  /** manifest 全集快照（hello 携带；重连即恢复已生成资产）。 */
  snapshot(): GeneratedAsset[] {
    return [...this.byId.values()];
  }

  /**
   * 预发射：命中即同步返回，未命中则后台生成（不阻塞演出）。
   * 同 id 已在飞则挂同一 Promise——同拍内重复 preload 不重复烧配额。
   */
  preload(type: "bg" | "cg", prompt: string, id: string): Promise<GeneratedAsset> {
    const cached = this.byId.get(id);
    if (cached) return Promise.resolve(cached);
    const running = this.inflight.get(id);
    if (running) return running;
    const job = this.run(type, prompt, id).finally(() => this.inflight.delete(id));
    this.inflight.set(id, job);
    return job;
  }

  private async run(type: "bg" | "cg", prompt: string, id: string): Promise<GeneratedAsset> {
    const file = fileName(type, prompt);
    await this.ensure(file, prompt);
    const asset: GeneratedAsset = {
      id,
      type,
      url: `/plays/${this.playId}/media/img/${file}`,
    };
    this.byId.set(id, asset);
    this.dirty = true;
    this.scheduleSave();
    return asset;
  }

  /**
   * 确保目标文件存在：磁盘有就复用，同指纹在飞就等它，都没有才排队生成。
   * 登记 `generating` 必须在任何 await 之前同步完成——否则两个调用都能在对方登记前
   * 读到空表，各自出一遍图（烧配额）。
   */
  private async ensure(file: string, prompt: string): Promise<void> {
    if (existsSync(this.store.imagePath(file))) return;
    let job = this.generating.get(file);
    if (!job) {
      job = this.generate(file, prompt);
      this.generating.set(file, job);
      void job
        .catch(() => {})
        .finally(() => {
          if (this.generating.get(file) === job) this.generating.delete(file);
        });
    }
    await job;
  }

  private async generate(file: string, prompt: string): Promise<void> {
    const target = this.store.imagePath(file);
    await this.acquire();
    try {
      // 排队期间可能已被别人生成出来（双重检查：入队前后各查一次磁盘）
      if (existsSync(target)) return;
      const { data } = await this.gen.generate(prompt);
      await mkdir(this.store.imageDir(), { recursive: true });
      const tmp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
      await writeFile(tmp, data);
      await rename(tmp, target);
    } finally {
      this.release();
    }
  }

  /** 取槽位：有余位且无人排队才直接进（否则会插队超发）。 */
  private async acquire(): Promise<void> {
    if (this.running < this.concurrency && this.queue.length === 0) {
      this.running += 1;
      return;
    }
    if (this.queue.length >= MAX_QUEUE) throw new Error("生图队列已满");
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  /** 放槽位：有人排队就直接把槽位转给他（running 不动），否则回收。 */
  private release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.running -= 1;
  }

  /** manifest 合并落盘：多图并发完成时串行写，盘上永远是最新全集。 */
  private scheduleSave(): void {
    if (!this.dirty) return;
    this.saving = this.saving.then(() => this.save());
  }

  /** 等 manifest 落盘完成——落盘是 fire-and-forget，时序敏感处别用 sleep 猜。 */
  async whenSaved(): Promise<void> {
    await this.saving;
  }

  private async save(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    const entries: ManifestEntry[] = [...this.byId.values()].map((a) => ({
      id: a.id,
      type: a.type,
      file: a.url.slice(a.url.lastIndexOf("/") + 1),
    }));
    try {
      await mkdir(this.store.imageDir(), { recursive: true });
      // 原子写：中途被杀不会留下残缺 JSON 拖垮下次载入
      const tmp = `${this.manifestPath()}.${randomUUID().slice(0, 8)}.tmp`;
      await writeFile(tmp, JSON.stringify(entries));
      await rename(tmp, this.manifestPath());
    } catch (error) {
      console.warn(
        `[stage-ai] 生图 manifest 落盘失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private manifestPath(): string {
    return join(this.store.imageDir(), "manifest.json");
  }
}
