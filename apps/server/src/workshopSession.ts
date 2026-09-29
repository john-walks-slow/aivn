import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ServerMessage, WorkshopAssetView, WorkshopChatMessage, WorkshopThreadInfo } from "@stage-ai/core";
import type { ImageBackend } from "./imageBackend.js";
import type { Limiter } from "./limiter.js";
import { PlayFiles } from "./playFiles.js";
import type { PlayStore } from "./store.js";
import {
  buildWorkshopPrompt,
  createWorkshopTools,
  deriveThreadTitle,
  runWorkshopTurn,
  type WorkshopMessage,
  type WorkshopWrite,
} from "./workshop.js";
import { WorkshopAssets, type GeneratedPlayAsset } from "./workshopAssets.js";
import { WorkshopThreads, type WorkshopThread } from "./workshopThreads.js";

/**
 * 工坊会话（D9）：一个剧目的工坊 runtime——线程管理 + 工坊 agent 执行 + 剧目文件编辑 + 素材生成。
 * 与 PlaywrightOrchestrator 平行、互不干扰：工坊在跑对话不影响演出，演出在跑不影响工坊。
 */

export interface WorkshopSessionOptions {
  playId: string;
  store: PlayStore;
  streamFn: StreamFn;
  model: Model<Api>;
  getApiKey: () => string | undefined;
  /** 向本剧目所有 WS 客户端广播。 */
  emit: (msg: ServerMessage) => void;
  /** 剧目文件被改动后通知宿主（play.json/memory/素材改动触发 runtime reload，保存即生效）。 */
  onFilesChanged: () => void;
  /** 生图后端；未配置则 `generate_asset` 工具直接回不可用（不装死工具）。 */
  imageBackend?: ImageBackend;
  /** 与 D6 预发射共用的生图并发闸门（挂 PlayHouse，reload 不换实例）。 */
  limiter: Limiter;
}

export class WorkshopSession {
  readonly files: PlayFiles;
  private readonly threads: WorkshopThreads;
  private readonly tools: AgentTool<any>[];
  private readonly assets?: WorkshopAssets;
  /** 当前线程（面板现场；服务端持有，任何客户端连上都看到同一条）。 */
  private activeId: string | null = null;
  /** 一轮对话在飞：拒绝并发发问（工坊对话是串行的）。 */
  private running = false;
  /** 本轮是否改过盘（文本或素材）：收束时统一触发一次 runtime 重建，避免多次腰斩演出。 */
  private changedDuringTurn = false;
  /** 本轮生成的素材：到达先攒着，收束时挂到最终那条 assistant 消息上（不落一半在气泡里）。 */
  private pendingAssets: WorkshopAssetView[] = [];

  constructor(private readonly opts: WorkshopSessionOptions) {
    this.files = new PlayFiles(opts.store);
    this.threads = new WorkshopThreads(opts.store);
    if (opts.imageBackend) {
      this.assets = new WorkshopAssets(opts.playId, {
        store: opts.store,
        files: this.files,
        backend: opts.imageBackend,
        limiter: opts.limiter,
        onWrite: (write) => this.broadcastWrite(write),
      });
    }
    this.tools = createWorkshopTools({
      files: this.files,
      store: opts.store,
      onWrite: (write) => this.broadcastWrite(write),
      assets: this.assets,
      onAsset: (asset) => this.broadcastAsset(asset),
    });
  }

  /** 面板打开 / 线程变动：回线程列表与当前现场消息。 */
  async snapshot(): Promise<void> {
    const threads = await this.threads.list();
    if (threads.length === 0) {
      this.activeId = null;
    } else if (!threads.some((t) => t.id === this.activeId && !t.archived)) {
      this.activeId = threads.find((t) => !t.archived)?.id ?? null;
    }
    this.opts.emit({ type: "workshop_threads", threads: threads.map(info), activeId: this.activeId });
    if (this.activeId) await this.sendHistory(this.activeId);
  }

  /** 切到指定线程（发消息时也用它同步现场）。 */
  async activate(threadId: string): Promise<void> {
    this.activeId = threadId;
    await this.snapshot();
  }

  async setArchived(threadId: string, archived: boolean): Promise<void> {
    await this.threads.update(threadId, { archived });
    if (archived && this.activeId === threadId) this.activeId = null;
    await this.snapshot();
  }

  async remove(threadId: string): Promise<void> {
    await this.threads.remove(threadId);
    if (this.activeId === threadId) this.activeId = null;
    await this.snapshot();
  }

  /** 发一轮工坊对话。无 threadId 时新建线程（标题取首条消息前 20 字）。 */
  async chat(text: string, threadId?: string): Promise<void> {
    const content = text.trim();
    if (content === "") return;
    if (this.running) {
      this.opts.emit({ type: "workshop_error", threadId: this.activeId, message: "工坊正在回复，稍后再发" });
      return;
    }
    let thread: WorkshopThread | undefined;
    if (threadId) {
      thread = (await this.threads.list()).find((t) => t.id === threadId);
    }
    if (!thread) thread = await this.threads.create(deriveThreadTitle(content));
    const active = thread;
    this.activeId = active.id;

    const history = await this.threads.messages(active.id);
    const userMessage: WorkshopMessage = { role: "user", text: content, at: Date.now() };
    // 首条消息定标题：线程可能是刚建的占位，也可能是空的历史线程
    await this.threads.append(active.id, userMessage, history.length === 0 ? { title: deriveThreadTitle(content) } : {});
    await this.snapshot();

    this.running = true;
    this.changedDuringTurn = false;
    this.pendingAssets = [];
    try {
      const answer = await runWorkshopTurn(
        {
          streamFn: this.opts.streamFn,
          model: this.opts.model,
          getApiKey: this.opts.getApiKey,
          tools: this.tools,
          systemPrompt: await this.systemPrompt(),
        },
        history,
        content,
        {
          onDelta: (delta) => this.opts.emit({ type: "workshop_chunk", threadId: active.id, delta }),
          onTool: (name) => this.opts.emit({ type: "workshop_tool", threadId: active.id, name }),
        },
      );
      const images = this.pendingAssets;
      this.pendingAssets = [];
      await this.threads.append(active.id, { role: "assistant", text: answer, at: Date.now(), images });
      this.opts.emit({ type: "workshop_done", threadId: active.id, text: answer, images });
    } catch (error) {
      // 出错也把已出的图交出去：前面几张图是真金白银，不能因为后续一步失败就凭空消失。
      // 必须落进 threads——收束后的 snapshot 会带着它重放，否则前端一收到 history
      // 就清空 pendingAssets，图只会闪一下就没了，刷新后连闪的资格都没有。
      const images = this.pendingAssets;
      this.pendingAssets = [];
      const message = error instanceof Error ? error.message : String(error);
      if (images.length > 0) {
        await this.threads.append(active.id, {
          role: "assistant",
          text: `（这一步中断了，但上面 ${images.length} 张图已经出好了）${message}`,
          at: Date.now(),
          images,
        });
      }
      this.opts.emit({ type: "workshop_error", threadId: active.id, message, images });
    } finally {
      this.running = false;
    }
    // 一轮里可能写了好几个文件、出了好几张图：收束后只重建一次（保存即生效）
    if (this.changedDuringTurn) this.opts.onFilesChanged();
    await this.snapshot();
  }

  /**
   * 文件浏览器改动（REST）：只落盘 + 触发 reload。
   * 不产生 `workshop_write` 撤销记录——那是「agent 改了什么」的账，人手改的自己在编辑器里看得见，
   * 否则点一次撤销就多一条记录，套娃到停不下来。
   */
  async writeFile(path: string, content: string): Promise<void> {
    await this.files.write(path, content);
    this.opts.onFilesChanged();
  }

  /** 文件浏览器删除（REST）：与 writeFile 同理，只落盘 + 触发 reload。 */
  async removeFile(path: string): Promise<void> {
    await this.files.remove(path);
    this.opts.onFilesChanged();
  }

  /** 写盘事件广播（可见 + 可撤销）；runtime 重建由本轮收束统一触发。 */
  private broadcastWrite(write: WorkshopWrite): void {
    this.changedDuringTurn = true;
    this.opts.emit({
      type: "workshop_write",
      threadId: this.activeId ?? "",
      path: write.path,
      before: write.before,
    });
  }

  /** 素材到货：先瞬态播报（对话流立刻可见），同时挂到本轮收束的那条消息上。 */
  private broadcastAsset(asset: GeneratedPlayAsset): void {
    this.changedDuringTurn = true;
    const view: WorkshopAssetView = { kind: asset.kind, path: asset.path, url: asset.url };
    this.pendingAssets.push(view);
    this.opts.emit({
      type: "workshop_asset",
      threadId: this.activeId ?? "",
      kind: asset.kind,
      path: asset.path,
      url: asset.url,
      replaced: asset.replaced,
    });
  }

  private async sendHistory(threadId: string): Promise<void> {
    const messages = await this.threads.messages(threadId);
    this.opts.emit({
      type: "workshop_history",
      threadId,
      messages: messages.map((m): WorkshopChatMessage => ({
        role: m.role,
        text: m.text,
        at: m.at,
        images: m.images,
      })),
    });
  }

  private async systemPrompt(): Promise<string> {
    const [play, files, readiness] = await Promise.all([
      this.opts.store.loadPlay(),
      this.files.list(),
      this.opts.store.readiness(),
    ]);
    const listing = files.map((f) => `${f.writable ? "可写" : "只读"} ${f.path}（${f.size}B）`).join("\n");
    return buildWorkshopPrompt(play.title, listing, readiness, !!this.assets);
  }
}

function info(thread: WorkshopThread): WorkshopThreadInfo {
  return {
    id: thread.id,
    title: thread.title,
    updatedAt: thread.updatedAt,
    archived: thread.archived,
    summary: thread.summary,
  };
}
