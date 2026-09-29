import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PlayStore } from "./store.js";
import type { WorkshopMessage } from "./workshop.js";

/**
 * meta-chat 多会话存储（D9）：一个剧目多条工坊线程（世界观 / 立绘 / 修补…），共享同一套剧目文件。
 * 落盘在剧目目录的 `workshop/`（运行时不进 git）：threads.json 是索引，<id>.json 是消息体。
 */

export interface WorkshopThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  /** 一句话概要（归档时生成，列表展示用；未生成为 null）。 */
  summary: string | null;
}

const INDEX_FILE = "threads.json";

export class WorkshopThreads {
  private readonly dir: string;

  constructor(store: PlayStore) {
    this.dir = join(store.dir, "workshop");
  }

  /** 线程列表（新建在前，归档沉底）。 */
  async list(): Promise<WorkshopThread[]> {
    const index = await this.loadIndex();
    return index.sort((a, b) => Number(a.archived) - Number(b.archived) || b.updatedAt - a.updatedAt);
  }

  /** 取一条线程的消息体（不存在返回空数组）。 */
  async messages(threadId: string): Promise<WorkshopMessage[]> {
    const path = this.messagesPath(threadId);
    if (!existsSync(path)) return [];
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as { messages?: WorkshopMessage[] };
      return raw.messages ?? [];
    } catch {
      // 撕裂/损坏的线程文件按空对话处理，不让它拖垮工坊面板
      return [];
    }
  }

  async create(title: string): Promise<WorkshopThread> {
    const now = Date.now();
    const thread: WorkshopThread = {
      id: `t${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
      title,
      createdAt: now,
      updatedAt: now,
      archived: false,
      summary: null,
    };
    const index = await this.loadIndex();
    index.push(thread);
    await this.saveIndex(index);
    return thread;
  }

  /** 追加一条消息并更新线程元信息（updatedAt / 标题补全）。 */
  async append(threadId: string, message: WorkshopMessage, patch: Partial<WorkshopThread> = {}): Promise<void> {
    const messages = await this.messages(threadId);
    messages.push(message);
    await this.saveMessages(threadId, messages);
    const index = await this.loadIndex();
    const thread = index.find((t) => t.id === threadId);
    if (thread) {
      thread.updatedAt = message.at;
      Object.assign(thread, patch);
      await this.saveIndex(index);
    }
  }

  async update(threadId: string, patch: Partial<WorkshopThread>): Promise<void> {
    const index = await this.loadIndex();
    const thread = index.find((t) => t.id === threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    Object.assign(thread, patch, { updatedAt: Date.now() });
    await this.saveIndex(index);
  }

  /** 删除线程（连消息体一起）。 */
  async remove(threadId: string): Promise<void> {
    const index = (await this.loadIndex()).filter((t) => t.id !== threadId);
    await this.saveIndex(index);
    await rm(this.messagesPath(threadId), { force: true });
  }

  /** 最近一次使用的线程 id（工坊面板打开时恢复现场）。 */
  async lastActive(): Promise<string | null> {
    const index = await this.loadIndex();
    const live = index.filter((t) => !t.archived).sort((a, b) => b.updatedAt - a.updatedAt);
    return live[0]?.id ?? null;
  }

  private messagesPath(threadId: string): string {
    if (!/^[\w-]+$/.test(threadId)) throw new Error(`非法线程 id: ${threadId}`);
    return join(this.dir, `${threadId}.json`);
  }

  private async loadIndex(): Promise<WorkshopThread[]> {
    const path = join(this.dir, INDEX_FILE);
    if (!existsSync(path)) return [];
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as WorkshopThread[];
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private async saveIndex(index: WorkshopThread[]): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, INDEX_FILE), JSON.stringify(index, null, 2), "utf8");
  }

  private async saveMessages(threadId: string, messages: WorkshopMessage[]): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.messagesPath(threadId), JSON.stringify({ messages }, null, 2), "utf8");
  }
}
