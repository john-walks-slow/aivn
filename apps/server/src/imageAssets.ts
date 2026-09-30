import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GeneratedAsset } from "@stage-ai/core";
import type { GeneratedNote } from "./prompt.js";
import type { PlayStore } from "./store.js";
import type { ImageAspect, ImageBackend } from "./imageBackend.js";
import { Limiter } from "./limiter.js";

/**
 * 生图资产层（D6）：剧目级 manifest + 内容寻址缓存 + 并发闸门 + 在飞去重。
 * - 复用键 = sha1(type + prompt + 画幅)：同描述不同 id 共用一张图，分岔/重演不重复烧配额；
 * - manifest 落 media-cache/img/manifest.json（id → 文件）：重连时 hello 直接带全集，
 *   资产不依赖「下一次预发射」才可见；文件缺失的条目跳过，磁盘是权威；
 * - 并发闸门与工坊生图共用同一个 Limiter（挂在 PlayHouse 上，reload 不会换实例），
 *   但本层走 high 优先级——预发射被工坊的串行对话挤到队尾就失去了意义。
 * 失败一律抛出由调用方降级（既有素材/氛围色），不留永久骨架。
 */

interface ManifestEntry {
  id: string;
  type: "bg" | "cg";
  file: string;
  /** 生图 prompt：模型当初的意图，落盘后下一轮剧作家才知道这张图画的是什么。 */
  prompt?: string;
}

/** 内存条目 = 协议形态 + prompt（prompt 不进 WS，只供提示词复用 id）。 */
type Asset = GeneratedAsset & { prompt?: string };

/** 舞台与 CG 都是横构图；立绘不归本层（铁律①，差分立绘走工坊素材层）。 */
const ASPECT_BY_TYPE: Record<"bg" | "cg", ImageAspect> = { bg: "16:9", cg: "16:9" };

/** 复用键：同类型同描述同画幅 → 同一张文件（不同类型的同描述算两张资产）。 */
function fileName(type: "bg" | "cg", prompt: string, aspectRatio: string): string {
  return `${createHash("sha1")
    .update(type)
    .update("\0")
    .update(prompt)
    .update("\0")
    .update(aspectRatio)
    .digest("hex")}.jpg`;
}

/** prompt 是内部注解，不外泄：WS 快照与 asset_ready 一律只带协议三字段。 */
function strip(asset: Asset): GeneratedAsset {
  return { id: asset.id, type: asset.type, url: asset.url };
}

export class ImageAssets {
  private readonly byId = new Map<string, Asset>();
  /** 同一 id 的在飞请求去重：preload 与引用它的 cg/scene 常在几轮内先后到达。 */
  private readonly inflight = new Map<string, Promise<GeneratedAsset>>();
  /** 同一张图（内容指纹）的在飞生成：不同 id 共用同描述时只出一次图。 */
  private readonly generating = new Map<string, Promise<void>>();
  private dirty = false;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly playId: string,
    private readonly store: PlayStore,
    private readonly gen: ImageBackend,
    private readonly limiter: Limiter,
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
        prompt: entry.prompt,
      });
    }
  }

  /** manifest 全集快照（hello 携带；重连即恢复已生成资产）。 */
  snapshot(): GeneratedAsset[] {
    return [...this.byId.values()].map(strip);
  }

  /** 已生成图目录（id + prompt）：注入剧作家提示词，让它记得自己造过哪些 id。 */
  notes(): GeneratedNote[] {
    return [...this.byId.values()]
      .filter((a): a is Asset & { prompt: string } => !!a.prompt)
      .map(({ id, type, prompt }) => ({ id, type, prompt }));
  }

  /**
   * 预发射：命中即同步返回，未命中则后台生成（不阻塞演出）。
   * 同 id 已在飞则挂同一 Promise——同轮内重复 preload 不重复烧配额。
   */
  preload(type: "bg" | "cg", prompt: string, id: string): Promise<GeneratedAsset> {
    const cached = this.byId.get(id);
    if (cached) return Promise.resolve(strip(cached));
    const running = this.inflight.get(id);
    if (running) return running;
    const job = this.run(type, prompt, id).finally(() => this.inflight.delete(id));
    this.inflight.set(id, job);
    return job;
  }

  private async run(type: "bg" | "cg", prompt: string, id: string): Promise<GeneratedAsset> {
    const file = fileName(type, prompt, ASPECT_BY_TYPE[type]);
    await this.ensure(file, prompt, type);
    const asset: Asset = {
      id,
      type,
      url: `/plays/${this.playId}/media/img/${file}`,
      prompt,
    };
    this.byId.set(id, asset);
    this.dirty = true;
    this.scheduleSave();
    return strip(asset);
  }

  /**
   * 确保目标文件存在：磁盘有就复用，同指纹在飞就等它，都没有才排队生成。
   * 登记 `generating` 必须在任何 await 之前同步完成——否则两个调用都能在对方登记前
   * 读到空表，各自出一遍图（烧配额）。
   */
  private async ensure(file: string, prompt: string, type: "bg" | "cg"): Promise<void> {
    if (existsSync(this.store.imagePath(file))) return;
    let job = this.generating.get(file);
    if (!job) {
      job = this.generate(file, prompt, type);
      this.generating.set(file, job);
      void job
        .catch(() => {})
        .finally(() => {
          if (this.generating.get(file) === job) this.generating.delete(file);
        });
    }
    await job;
  }

  private async generate(file: string, prompt: string, type: "bg" | "cg"): Promise<void> {
    const target = this.store.imagePath(file);
    await this.limiter.run(async () => {
      // 排队期间可能已被别人生成出来（双重检查：入队前后各查一次磁盘）
      if (existsSync(target)) return;
      const { data } = await this.gen.generate({ prompt, aspectRatio: ASPECT_BY_TYPE[type] });
      await mkdir(this.store.imageDir(), { recursive: true });
      const tmp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
      await writeFile(tmp, data);
      await rename(tmp, target);
    }, "high");
  }

  /**
   * manifest 合并落盘：多图并发完成时串行写，盘上永远是最新全集。
   *
   * 刻意 fire-and-forget——preload 是演出侧的后台预发射，不能被一次磁盘写阻塞。
   * 代价是 preload 返回时 manifest 还没进盘，此刻进程被杀会丢掉这个条目（图在盘上但没索引）。
   * 需要确定落盘时（进程退出、断言缓存复用）用 `flush()`。
   */
  private scheduleSave(): void {
    if (!this.dirty) return;
    this.saving = this.saving.then(() => this.save());
  }

  /** 等 manifest 落盘完成：save 是异步链，调用方需要「已落盘」的确定时刻而不是猜一个 sleep。 */
  async flush(): Promise<void> {
    await this.saving;
  }

  private async save(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    const entries: ManifestEntry[] = [...this.byId.values()].map((a) => ({
      id: a.id,
      type: a.type,
      file: a.url.slice(a.url.lastIndexOf("/") + 1),
      ...(a.prompt ? { prompt: a.prompt } : {}),
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
