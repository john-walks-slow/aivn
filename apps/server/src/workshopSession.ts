import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  AgentSettings,
  ServerMessage,
  WorkshopAssetView,
  WorkshopChatMessage,
  WorkshopThreadInfo,
} from "@aivn/core";
import { parsePlayConfig, resolveCraft } from "@aivn/core";
import type { Exa } from "./exa.js";
import type { WebImageFetcher } from "./webImage.js";
import { PlayFiles } from "./playFiles.js";
import type { AssetLibrary } from "./library.js";
import type { VoiceCatalogService } from "./voiceCatalog.js";
import type { PlaySaves } from "./saves.js";
import type { PlayStore } from "./store.js";
import {
  buildWorkshopPrompt,
  deriveThreadTitle,
  historyToMessages,
  runWorkshopTurn,
  summarizeThread,
  type WorkshopMessage,
  type PlayFileWrite,
} from "./workshop.js";
import {
  capDigest,
  estimateThreadTokens,
  pickThreadCutIndex,
  type EpochSummary,
} from "./compaction.js";
import { createAgentKit, enabledToolsFor, type AgentKit } from "./agentkit/kit.js";
import type { PlayAssets } from "./playAssets.js";
import { WorkshopThreads, type ThreadCompaction, type WorkshopThread } from "./workshopThreads.js";

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
  /**
   * 素材生成层（PlayHouse 按剧目缓存的那一个，与剧作家共用）。
   * 未启用生图时不传：工具回「生图未启用」，提示词也不注入出图章节。
   */
  playAssets?: PlayAssets;
  /** 周目（存档）管理面：read_lineage 前先列周目。 */
  saves: PlaySaves;
  /** 按 saveId 取存档级操作面（读故事树只走磁盘 session.json，不建 runtime）。 */
  saveStore: (saveId: string) => PlayStore;
  /** 应用级素材资源库：工坊 agent 可浏览与导入（只读，库本身由用户在本地目录维护）。 */
  assetLibrary?: AssetLibrary;
  /** 公共音色库客户端：list_voices 走它。没配 TTS 时为 undefined，工具不注册。 */
  voices?: VoiceCatalogService;
  /** 联网检索客户端；未配置则 `web_search` 工具不注册、prompt 不提联网。 */
  exa?: Exa;
  /** 网络图下载器；没有它 `view_image` 只认本地路径。 */
  webImage?: WebImageFetcher;
  /** 工坊 agent 的运行设置（play.json 的 agents.workshop）：思考档位与工具开关。 */
  agents?: AgentSettings;
  /** 线程压缩参数（工坊可用自己的 STAGE_WORKSHOP_* 一组 env）；不给 = 不压缩。 */
  compaction?: {
    contextWindow: number;
    triggerRatio: number;
    keepRecentTokens: number;
  };
}

export class WorkshopSession {
  readonly files: PlayFiles;
  private readonly threads: WorkshopThreads;
  private readonly kit: AgentKit;
  /** 当前线程（面板现场；服务端持有，任何客户端连上都看到同一条）。 */
  private activeId: string | null = null;
  /** 一轮对话在飞：拒绝并发发问（工坊对话是串行的）。 */
  private running = false;
  /** 剧目被改动过（agent 写盘、素材到货、bash 跑过、文件页手改）：置脏只走 `markChanged`。 */
  private changedDuringTurn = false;
  /** 攒下的改动里有 bash：它的写绕开 `PlayFiles`，play.json 的结构校验一道都没过。 */
  private bashDuringTurn = false;
  /** 本轮生成的素材：到达先攒着，收束时挂到最终那条 assistant 消息上（不落一半在气泡里）。 */
  private pendingAssets: WorkshopAssetView[] = [];

  constructor(private readonly opts: WorkshopSessionOptions) {
    this.files = new PlayFiles(opts.store);
    this.threads = new WorkshopThreads(opts.store);
    this.kit = createAgentKit({
      role: "workshop",
      playId: opts.playId,
      enabled: enabledToolsFor("workshop", opts.agents?.tools),
      thinking: opts.agents?.thinking,
      files: this.files,
      store: opts.store,
      onWrite: (write) => this.broadcastWrite(write),
      onAsset: (asset, replaced) => this.broadcastAsset(asset, replaced),
      playAssets: opts.playAssets,
      saves: opts.saves,
      saveStore: opts.saveStore,
      assetLibrary: opts.assetLibrary,
      voices: opts.voices,
      exa: opts.exa,
      webImage: opts.webImage,
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
    // 一进门就占位：读线程与开跑前的压缩摘要都在飞，期间再发一条会开出第二个 turn
    // （摘要要走一次模型请求，空档能到秒级）。
    this.running = true;
    this.changedDuringTurn = false;
    this.bashDuringTurn = false;
    this.pendingAssets = [];
    try {
      let thread: WorkshopThread | undefined;
      if (threadId) {
        thread = (await this.threads.list()).find((t) => t.id === threadId);
      }
      if (!thread) thread = await this.threads.create(deriveThreadTitle(content));
      const active = thread;
      this.activeId = active.id;

      const history = await this.threads.messages(active.id);
      // 开跑前先看要不要压：压了才不等到这轮请求直接被窗口撑爆。
      const { visible, prompt } = await this.maybeCompact(active, history);
      const userMessage: WorkshopMessage = { role: "user", text: content, at: Date.now() };
      // 首条消息定标题：线程可能是刚建的占位，也可能是空的历史线程
      await this.threads.append(active.id, userMessage, history.length === 0 ? { title: deriveThreadTitle(content) } : {});
      await this.snapshot();

      const turn = await runWorkshopTurn(
        {
          streamFn: this.opts.streamFn,
          model: this.opts.model,
          getApiKey: this.opts.getApiKey,
          tools: this.kit.tools,
          thinkingLevel: this.kit.thinking,
          systemPrompt: prompt,
        },
        visible,
        content,
        {
          onDelta: (delta) => this.opts.emit({ type: "workshop_chunk", threadId: active.id, delta }),
          onTool: (name) => this.opts.emit({ type: "workshop_tool", threadId: active.id, name }),
          // bash 的改动不经过 onWrite（它不走 PlayEnv.writeFile），只能在这里记账。
          // 不置脏的话，模型用 sed / mv 改完文件，宿主以为什么都没变、不会重建 runtime。
          onToolDone: (name) => {
            if (name === "bash") {
              this.bashDuringTurn = true;
              this.markChanged();
            }
          },
        },
      );
      if (turn.scale !== null) {
        await this.threads.update(active.id, { tokenScale: turn.scale });
        active.tokenScale = turn.scale;
      }
      const images = this.pendingAssets;
      this.pendingAssets = [];
      await this.threads.append(active.id, { role: "assistant", text: turn.text, at: Date.now(), images });
      this.opts.emit({ type: "workshop_done", threadId: active.id, text: turn.text, images });
    } catch (error) {
      // 出错也把已出的图交出去：前面几张图是真金白银，不能因为后续一步失败就凭空消失。
      // 必须落进 threads——收束后的 snapshot 会带着它重放，否则前端一收到 history
      // 就清空 pendingAssets，图只会闪一下就没了，刷新后连闪的资格都没有。
      const images = this.pendingAssets;
      this.pendingAssets = [];
      const message = error instanceof Error ? error.message : String(error);
      const activeId = this.activeId ?? threadId ?? "";
      if (images.length > 0) {
        await this.threads.append(activeId, {
          role: "assistant",
          text: `（这一步中断了，但上面 ${images.length} 张图已经出好了）${message}`,
          at: Date.now(),
          images,
        });
      }
      this.opts.emit({ type: "workshop_error", threadId: activeId, message, images });
    } finally {
      this.running = false;
      // 一轮里可能写了好几个文件、出了好几张图：收束后只重建一次（保存即生效）
      await this.applyChanges();
      await this.snapshot();
    }
  }

  /**
   * 记一笔：剧目被改动了。**唯一的置脏入口**——agent 写盘、素材到货、bash 跑过、
   * 文件页手改，四条路都从这儿过，不再各置各的旗。
   */
  private markChanged(): void {
    this.changedDuringTurn = true;
  }

  /**
   * 把攒下的改动兑现：真有改动才校验、才重建。**唯一的收束出口**。
   *
   * 回合内攒着，收束时重建一次——一轮写十个文件也只 rebuild 一次；回合外的文件页保存
   * 没有收束可等，就地兑现。坏 play.json 只告警不重建：带着一份解析不了的配置去 rebuild
   * 只会抛在 `void` 的 promise 里，用户看到的是「面板不刷新了」而不是「哪里坏了」。
   */
  private async applyChanges(): Promise<void> {
    if (!this.changedDuringTurn) return;
    this.changedDuringTurn = false;
    // 只有 bash 绕得开 PlayFiles 的结构校验；本轮没跑过就不必读盘
    if (this.bashDuringTurn) {
      this.bashDuringTurn = false;
      const broken = await this.playConfigBrokenReason();
      if (broken) {
        this.opts.emit({ type: "workshop_error", threadId: this.activeId, message: broken });
        return;
      }
    }
    this.opts.onFilesChanged();
  }

  /** bash 写的 play.json 不过结构校验：收束前补一次读盘检查，坏了就说清楚（只告警不回滚）。 */
  private async playConfigBrokenReason(): Promise<string | null> {
    try {
      parsePlayConfig(JSON.parse(await this.files.read("play.json")));
      return null;
    } catch (error) {
      return `play.json 现在解析不了，已跳过这次的运行时重建：${error instanceof Error ? error.message : String(error)}。直接在「文件」页改回来，或让搭台助手重写一份。`;
    }
  }

  /**
   * 文件浏览器改动（REST）：落盘 + 就地兑现。
   * 不产生 `workshop_write` 撤销记录——那是「agent 改了什么」的账，人手改的自己在编辑器里看得见，
   * 否则点一次撤销就多一条记录，套娃到停不下来。
   */
  async writeFile(path: string, content: string): Promise<void> {
    await this.files.write(path, content);
    this.markChanged();
    await this.applyChanges();
  }

  /** 文件浏览器删除（REST）：与 writeFile 同理，只落盘 + 就地兑现。 */
  async removeFile(path: string): Promise<void> {
    await this.files.remove(path);
    this.markChanged();
    await this.applyChanges();
  }

  /** 写盘事件广播（可见 + 可撤销）；runtime 重建由 `applyChanges` 统一收束。 */
  private broadcastWrite(write: PlayFileWrite): void {
    this.markChanged();
    this.opts.emit({
      type: "workshop_write",
      threadId: this.activeId ?? "",
      path: write.path,
      before: write.before,
    });
  }

  /**
   * 转发一次写盘事件（供剧目级 PlayAssets 调用：素材层归 PlayHouse 所有，
   * 但撤销条要挂进**当前工坊线程**的对话流里，只有会话知道 threadId）。
   */
  pushWrite(write: PlayFileWrite): void {
    this.broadcastWrite(write);
  }

  /** 转发一次素材到货事件（同 pushWrite）。 */
  pushAsset(asset: WorkshopAssetView): void {
    this.broadcastAsset(asset);
  }

  /** 素材到货：先瞬态播报（对话流立刻可见），同时挂到本轮收束的那条消息上。 */
  private broadcastAsset(asset: WorkshopAssetView, replaced = false): void {
    this.markChanged();
    this.pendingAssets.push(asset);
    this.opts.emit({
      type: "workshop_asset",
      threadId: this.activeId ?? "",
      kind: asset.kind,
      path: asset.path,
      url: asset.url,
      replaced,
    });
  }

  private async sendHistory(threadId: string): Promise<void> {
    const [messages, thread] = await Promise.all([
      this.threads.messages(threadId),
      this.threads.list(),
    ]);
    const compaction = thread.find((t) => t.id === threadId)?.compaction ?? null;
    this.opts.emit({
      type: "workshop_history",
      threadId,
      compaction: compaction && {
        cutAt: compaction.cutAt,
        oneLiner: compaction.oneLiner,
        body: compaction.body,
      },
      messages: messages.map((m): WorkshopChatMessage => ({
        role: m.role,
        text: m.text,
        at: m.at,
        images: m.images,
      })),
    });
  }

  /**
   * 开跑前的线程压缩：对话体涨到窗口预算（默认 60%）时，把早期轮次压成一张摘要卡。
   * 与演出侧同一套治理、同一时刻（每轮开跑前），只是产物落线程而不是 memory/arcs——
   * 工坊会话是搭台过程，不是剧目事实，进 arcs 会污染剧作家每轮注入的 A 区。
   *
   * 消息文件一条不删：只有前 cutAt 条移出 agent 上下文，用户眼前的历史照常完整。
   * 摘要失败只告警不动对话体（压缩是优化不是正确性前提）。
   */
  private async maybeCompact(
    thread: WorkshopThread,
    history: readonly WorkshopMessage[],
  ): Promise<{ visible: WorkshopMessage[]; prompt: string }> {
    const compaction = thread.compaction ?? null;
    const view = compaction?.cutAt ?? 0;
    const visible = history.slice(view);
    const scale = thread.tokenScale ?? 1;
    const prompt = await this.systemPrompt(compaction?.body);

    const limit = this.opts.compaction;
    if (!limit) return { visible, prompt };
    const used = estimateThreadTokens(prompt, historyToMessages(visible), scale);
    if (used <= Math.floor(limit.contextWindow * limit.triggerRatio)) return { visible, prompt };

    const cut = pickThreadCutIndex(visible, limit.keepRecentTokens, scale);
    if (cut === 0) return { visible, prompt };
    const head = visible.slice(0, cut);
    let digest: EpochSummary;
    try {
      digest = await summarizeThread(
        {
          streamFn: this.opts.streamFn,
          model: this.opts.model,
          getApiKey: this.opts.getApiKey,
        },
        head,
        compaction?.body ?? "",
      );
    } catch (error) {
      console.warn(
        `[aivn] 工坊线程压缩跳过（摘要生成失败）: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { visible, prompt };
    }
    const next: ThreadCompaction = {
      at: Date.now(),
      cutAt: view + cut,
      oneLiner: digest.oneLiner,
      // 模型是拿旧定稿重写成一份完整文档，不是把两段叠起来（叠加几轮就全是历史噪音）。
      body: capDigest(digest.body),
      epochs: (compaction?.epochs ?? 0) + 1,
    };
    await this.threads.update(thread.id, { compaction: next, summary: next.oneLiner });
    thread.compaction = next;
    thread.tokenScale = scale;
    console.log(
      `[aivn] 工坊线程压缩：${used} tok → 保留 ${visible.length - cut}/${visible.length} 条，epoch=${next.epochs}`,
    );
    return {
      visible: visible.slice(cut),
      prompt: await this.systemPrompt(next.body),
    };
  }

  private async systemPrompt(digest?: string): Promise<string> {
    const [play, files, readiness] = await Promise.all([
      this.opts.store.loadPlay(),
      this.files.list(),
      this.opts.store.readiness(),
    ]);
    const listing = files.map((f) => `${f.writable ? "可写" : "只读"} ${f.path}（${f.size}B）`).join("\n");
    return buildWorkshopPrompt({
      title: play.title,
      files: listing,
      readiness,
      // 同样现读：用户刚在设定页换完语音语言，下一轮挑音色就该按新值筛
      voiceLanguage: play.voiceLanguage,
      scriptLanguage: play.scriptLanguage,
      // 写作参数与出图审批也现读：用户刚在「写作参数」卡里改完，下一轮说话就该按新口径
      craft: resolveCraft(play.craft),
      imageApproval: play.agents?.workshop?.imageApproval,
      can: this.kit.can,
      digest,
      // 从当轮现读的 play.json 取，不吃构造时的快照：用户刚在 Agent 页改完就发下一轮消息，
      // 那条就该带新提示词（模型/工具开关走 opts.agents，改动会重建 runtime 才生效）。
      customPrompt: play.agents?.workshop?.prompt,
    });
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
