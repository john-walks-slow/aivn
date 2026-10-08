import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  AgentSettings,
  ServerMessage,
  WorkshopAssetView,
  WorkshopChatMessage,
  WorkshopPart,
  WorkshopThreadInfo,
} from "@aivn/core";
import {
  appendText,
  appendThinking,
  attachToolAssets,
  endTool,
  parsePlayConfig,
  resolveCraft,
  startTool,
} from "@aivn/core";
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
import { createAgentKit, enabledCapabilitiesFor, type AgentKit } from "./agentkit/kit.js";
import type { PlayAssets } from "./playAssets.js";
import type { PlayConfig } from "@aivn/core";
import type { GenerateMusicRequest, PlayMusic } from "./playMusic.js";
import { WorkshopThreads, type ThreadCompaction, type WorkshopThread } from "./workshopThreads.js";

/**
 * 工坊会话（D9）：一个剧目的工坊 runtime——线程管理 + 工坊 agent 执行 + 剧目文件编辑 + 素材生成。
 * 与 PlaywrightOrchestrator 平行、互不干扰：工坊在跑对话不影响演出，演出在跑不影响工坊。
 */

export interface WorkshopSessionOptions {
  playId: string;
  store: PlayStore;
  streamFn: StreamFn;
  /** 单轮开跑前现取一次：模型/工坊设置/剧目配置（工坊实例不随 runtime 重建，改完即生效）。 */
  getRunConfig: () => Promise<{ model: Model<Api>; agents?: AgentSettings; play: PlayConfig }>;
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
  /** 音乐生成层（未启用音乐生成时不传：不注册 generate_bgm，提示词也不提出歌）。 */
  playMusic?: PlayMusic;
  /** 后台发起 BGM 生成：宿主记账与到货广播，工具那边不等它（未启用音乐生成时不传）。 */
  queueMusic?: (req: GenerateMusicRequest) => string;
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
  /** 线程压缩参数（工坊可用自己的 STAGE_WORKSHOP_* 一组 env）；不给 = 不压缩。 */
  compaction?: {
    contextWindow: number;
    triggerRatio: number;
    keepRecentTokens: number;
  };
}

/** 本轮到货的素材：`toolCallId` 是产出它的那次调用（外部推来的没有，走消息级预览）。 */
interface PendingAsset extends WorkshopAssetView {
  replaced: boolean;
  toolCallId?: string;
}

export class WorkshopSession {
  readonly files: PlayFiles;
  private readonly threads: WorkshopThreads;
  private kit: AgentKit;
  /** 当前线程（面板现场；服务端持有，任何客户端连上都看到同一条）。 */
  private activeId: string | null = null;
  /** 一轮对话在飞：拒绝并发发问（工坊对话是串行的）。 */
  private running = false;
  /** 当前轮的中止闸：`stop()` 扳它，runWorkshopTurn 监听它。 */
  private turnAbort: AbortController | null = null;
  /** 正在跑这一轮的线程：广播与异常落盘都归到它，不认「面板当前看哪条」。 */
  private runningThreadId: string | null = null;
  /** 剧目被改动过（agent 写盘、素材到货、bash 跑过、文件页手改）：置脏只走 `markChanged`。 */
  private changedDuringTurn = false;
  /** 攒下的改动里有 bash：它的写绕开 `PlayFiles`，play.json 的结构校验一道都没过。 */
  private bashDuringTurn = false;
  /** 本轮到货的素材：到达先攒着，收束时挂到产出它的那次调用上（不落一半在气泡里）。 */
  private pendingAssets: PendingAsset[] = [];

  constructor(private readonly opts: WorkshopSessionOptions) {
    this.files = new PlayFiles(opts.store);
    this.threads = new WorkshopThreads(opts.store);
    this.kit = createAgentKit({
      role: "workshop",
      playId: opts.playId,
      capabilities: enabledCapabilitiesFor("workshop", undefined),
      thinking: undefined,
      files: this.files,
      store: opts.store,
      onWrite: (write) => this.broadcastWrite(write),
      onAsset: (asset, replaced, toolCallId) => this.broadcastAsset(asset, replaced, toolCallId),
      playAssets: opts.playAssets,
      playMusic: opts.playMusic,
      queueMusic: opts.queueMusic,
      saves: opts.saves,
      saveStore: opts.saveStore,
      assetLibrary: opts.assetLibrary,
      voices: opts.voices,
      exa: opts.exa,
      webImage: opts.webImage,
    });
  }

  /** 每轮开跑前按 play.json 现取模型与工坊设置，重装 kit——用户刚在 Agent 页改完立刻生效。 */
  private turnPlay?: PlayConfig;
  private async freshTurnContext(): Promise<{ model: Model<Api>; agents?: AgentSettings }> {
    const { model, agents, play } = await this.opts.getRunConfig();
    this.turnPlay = play;
    this.kit = createAgentKit({
      role: "workshop",
      playId: this.opts.playId,
      capabilities: enabledCapabilitiesFor("workshop", agents?.capabilities),
      thinking: agents?.thinking,
      files: this.files,
      store: this.opts.store,
      onWrite: (write) => this.broadcastWrite(write),
      onAsset: (asset, replaced, toolCallId) => this.broadcastAsset(asset, replaced, toolCallId),
      playAssets: this.opts.playAssets,
      playMusic: this.opts.playMusic,
      queueMusic: this.opts.queueMusic,
      saves: this.opts.saves,
      saveStore: this.opts.saveStore,
      assetLibrary: this.opts.assetLibrary,
      voices: this.opts.voices,
      exa: this.opts.exa,
      webImage: this.opts.webImage,
    });
    return { model, agents };
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
      this.opts.emit({
        type: "workshop_error",
        threadId: this.activeId,
        message: "工坊正在回复，稍后再发",
        parts: [],
      });
      return;
    }
    // 一进门就占位：读线程与开跑前的压缩摘要都在飞，期间再发一条会开出第二个 turn
    // （摘要要走一次模型请求，空档能到秒级）。
    this.running = true;
    this.changedDuringTurn = false;
    this.bashDuringTurn = false;
    this.pendingAssets = [];
    const turnAbort = new AbortController();
    this.turnAbort = turnAbort;
    // 本轮的段落流。声明在 try 外面：中途抛错时它得留着——用户至少要看得见它读了哪些文件、
    // 卡在哪一步，而不是一段文字全没了。
    let parts: WorkshopPart[] = [];
    try {
      let thread: WorkshopThread | undefined;
      if (threadId) {
        thread = (await this.threads.list()).find((t) => t.id === threadId);
      }
      if (!thread) thread = await this.threads.create(deriveThreadTitle(content));
      const active = thread;
      this.activeId = active.id;
      this.runningThreadId = active.id;

      const history = await this.threads.messages(active.id);
      // 开跑前先看要不要压：压了才不等到这轮请求直接被窗口撑爆。
      const { model } = await this.freshTurnContext();
      const { visible, prompt } = await this.maybeCompact(active, history, model);
      const userMessage: WorkshopMessage = { role: "user", text: content, at: Date.now() };
      // 首条消息定标题：线程可能是刚建的占位，也可能是空的历史线程
      await this.threads.append(active.id, userMessage, history.length === 0 ? { title: deriveThreadTitle(content) } : {});
      await this.snapshot();

      const turn = await runWorkshopTurn(
        {
          streamFn: this.opts.streamFn,
          model,
          getApiKey: this.opts.getApiKey,
          tools: this.kit.tools,
          thinkingLevel: this.kit.thinking,
          systemPrompt: prompt,
          signal: turnAbort.signal,
        },
        visible,
        content,
        {
          onDelta: (delta) => {
            parts = appendText(parts, delta);
            this.opts.emit({ type: "workshop_chunk", threadId: active.id, delta });
          },
          onThinking: (delta) => {
            parts = appendThinking(parts, delta);
            this.opts.emit({ type: "workshop_thinking", threadId: active.id, delta });
          },
          onToolStart: (tool) => {
            parts = startTool(parts, tool);
            this.opts.emit({
              type: "workshop_tool_start",
              threadId: active.id,
              id: tool.id,
              name: tool.name,
              args: tool.args,
            });
          },
          onToolEnd: (tool) => {
            parts = endTool(parts, {
              id: tool.id,
              result: tool.result,
              isError: tool.isError,
              ms: tool.ms,
            });
            this.opts.emit({
              type: "workshop_tool_end",
              threadId: active.id,
              id: tool.id,
              result: tool.result,
              isError: tool.isError,
              ms: tool.ms,
            });
            // bash 的改动不经过 onWrite（它不走 PlayEnv.writeFile），只能在这里记账。
            // 不置脏的话，模型用 sed / mv 改完文件，宿主以为什么都没变、不会重建 runtime。
            if (tool.name === "bash") {
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
      const settled = this.settleAssets(parts);
      await this.threads.append(active.id, {
        role: "assistant",
        text: turn.text,
        at: Date.now(),
        parts: settled.parts,
        images: settled.images,
      });
      this.opts.emit({
        type: "workshop_done",
        threadId: active.id,
        text: turn.text,
        parts: settled.parts,
        images: settled.images,
      });
    } catch (error) {
      // 出错也把已经发生的事交出去：前面几张图是真金白银，读过的文件、跑过的命令也不该凭空消失。
      // 必须落进 threads——收束后的 snapshot 会带着它重放，否则前端一收到 history
      // 就清空现场，这些只会闪一下就没了，刷新后连闪的资格都没有。
      const settled = this.settleAssets(parts);
      const message = error instanceof Error ? error.message : String(error);
      const activeId = this.runningThreadId ?? this.activeId ?? threadId ?? "";
      if (settled.parts.length > 0 || settled.images.length > 0) {
        const note =
          settled.images.length > 0
            ? `（这一步中断了，但上面 ${settled.images.length} 张图已经出好了）${message}`
            : `（这一步中断了）${message}`;
        await this.threads.append(activeId, {
          role: "assistant",
          text: note,
          at: Date.now(),
          parts: settled.parts,
          images: settled.images,
        });
      }
      this.opts.emit({
        type: "workshop_error",
        threadId: activeId,
        message,
        parts: settled.parts,
        images: settled.images,
      });
    } finally {
      this.running = false;
      this.turnAbort = null;
      // 一轮里可能写了好几个文件、出了好几张图：收束后只重建一次（保存即生效）
      // applyChanges/snapshot 期间广播仍归本轮线程（如 bash 弄坏 play.json 的告警）
      await this.applyChanges();
      await this.snapshot();
      // 轮次已收束：广播/落盘恢复走浏览态 activeId
      this.runningThreadId = null;
      this.turnPlay = undefined;
    }
  }

  /** 用户主动停止当前一轮生成：扳动中止闸，进行中的流/工具调用会尽快收束。 */
  stop(): void {
    this.turnAbort?.abort();
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
        this.opts.emit({ type: "workshop_error", threadId: this.activeId, message: broken, parts: [] });
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
   * 人手改的不广播——文件页自己看得见改了什么，不需要再推一条通知。
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

  /** 写盘事件广播（只当刷新信号，各页重拉）；runtime 重建由 `applyChanges` 统一收束。 */
  private broadcastWrite(write: PlayFileWrite): void {
    const threadId = this.runningThreadId ?? this.activeId;
    this.markChanged();
    this.opts.emit({
      type: "workshop_write",
      threadId: threadId ?? "",
      path: write.path,
    });
  }

  /**
   * 转发一次写盘事件（供剧目级 PlayAssets 调用：素材层归 PlayHouse 所有，
   * 但刷新信号要挂进**当前工坊线程**的对话流里，只有会话知道 threadId）。
   */
  pushWrite(write: PlayFileWrite): void {
    this.broadcastWrite(write);
  }

  /**
   * 转发一次素材到货事件（同 pushWrite）。
   *
   * `toolCallId` 由产它的工具带来（生图 / BGM 生成），据此把播放器归位到那次调用的行上；
   * 外部推来的（资源库导入那条路）没有调用号，走消息级预览。
   */
  pushAsset(asset: WorkshopAssetView, replaced = false, toolCallId?: string): void {
    this.broadcastAsset(asset, replaced, toolCallId);
  }

  /** 素材到货：先瞬态播报（对话流立刻可见，带调用号的挂到那次调用的行上），收束时并入段落。 */
  private broadcastAsset(asset: WorkshopAssetView, replaced = false, toolCallId?: string): void {
    const threadId = this.runningThreadId ?? this.activeId;
    this.markChanged();
    this.pendingAssets.push({ ...asset, replaced, toolCallId });
    this.opts.emit({
      type: "workshop_asset",
      threadId: threadId ?? "",
      toolCallId,
      kind: asset.kind,
      path: asset.path,
      url: asset.url,
      replaced,
    });
  }

  /**
   * 收束本轮攒下的素材：带 `toolCallId` 的挂到产出它的那次调用上（展开那一行才看见），
   * 不带的留在消息级 `images` 里（`pushAsset` 这条外部路径没有调用号可挂）。
   */
  private settleAssets(parts: WorkshopPart[]): {
    parts: WorkshopPart[];
    images: WorkshopAssetView[];
  } {
    let settled = parts;
    const images: WorkshopAssetView[] = [];
    for (const asset of this.pendingAssets) {
      const view: WorkshopAssetView = { kind: asset.kind, path: asset.path, url: asset.url };
      if (asset.toolCallId) settled = attachToolAssets(settled, asset.toolCallId, [view]);
      else images.push(view);
    }
    this.pendingAssets = [];
    return { parts: settled, images };
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
        parts: m.parts,
        images: m.images,
      })),
    });
  }

  /**
   * 开跑前的线程压缩：对话体涨到窗口预算（默认 60%）时，把早期轮次压成一份摘要。
   * 与演出侧同一套治理、同一时刻（每轮开跑前），只是产物落线程元数据——工坊会话是搭台过程，
   * 不是剧目事实，落进剧目记忆只会污染剧作家每轮注入的 A 区。
   *
   * 消息文件一条不删：只有前 cutAt 条移出 agent 上下文，用户眼前的历史照常完整。
   * 摘要失败只告警不动对话体（压缩是优化不是正确性前提）。
   */
  private async maybeCompact(
    thread: WorkshopThread,
    history: readonly WorkshopMessage[],
    model: Model<Api>,
  ): Promise<{ visible: WorkshopMessage[]; prompt: string }> {
    const compaction = thread.compaction ?? null;
    const view = compaction?.cutAt ?? 0;
    const visible = history.slice(view);
    const scale = thread.tokenScale ?? 1;
    const prompt = await this.systemPrompt(compaction?.body);

    const limit = this.opts.compaction
      ? {
          ...this.opts.compaction,
          contextWindow: Math.min(
            this.opts.compaction.contextWindow,
            model?.contextWindow ?? Infinity,
          ),
        }
      : undefined;
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
          model,
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
      this.turnPlay ? Promise.resolve(this.turnPlay) : this.opts.store.loadPlay(),
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
      // 那条就该带新提示词（模型/工具开关在每轮开跑前现取并重装 kit，立即生效）。
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
