import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReadPos } from "@stage-ai/core";
import { api, type PlayDetail } from "../api.js";
import { navigate } from "../router.jsx";
import { useStageSocket, type WorkshopInbound } from "../stage/useStageSocket.js";
import { usePlayback } from "../stage/director.js";
import { VoiceDirector } from "../stage/audio.js";
import { buildAssetIndex, type AssetIndex } from "../stage/assets.js";
import { useGeneratedAssets } from "../stage/generatedAssets.js";
import {
  BacklogView,
  HistoryView,
  StageTheater,
  type DirectorTargets,
} from "../stage/StageTheater.js";
import type { StageView } from "../stage/view.js";
import { stageTabFromQuery, stageViewFromQuery, workshopConnectionFromQuery } from "../stage/view.js";
import { RouteTree, useLineage, type LineageOps } from "../stage/LineagePanel.js";
import { CgView } from "../stage/CgView.js";
import type { RouteControls } from "../stage/RouteCanvas.js";
import { StageShell } from "../stage/StageShell.js";
import { Icon } from "../ui/Icon.js";
import { beatAtLine, buildBeats, editableNodeAtLine } from "../stage/beats.js";
import { buildTranscript, type TranscriptEntry } from "../stage/transcript.js";
import { ToastStack, useToasts } from "../stage/toast.js";
import { StopPanel } from "../stage/StopPanel.js";
import { stopAffordance } from "../stage/playbackState.js";
import {
  readFlag,
  writeFlag,
  SETTING_CONTINUE_CARD,
  SETTING_VOICE,
} from "../stage/settings.js";
import { PromptQueuePanel } from "../stage/PromptQueuePanel.js";
import { useVisualViewport } from "../stage/viewport.js";
import { useEscape } from "../ui/escape.js";
import { WorkshopPane } from "../workshop/WorkshopPane.js";

/** 阅读位置上报的防抖窗口：打字机逐字推进，1s 内只发最后一次位置。 */
const READ_REPORT_MS = 1000;

/** 演出屏：舞台（视觉层+打字机+导演栏）/ 回顾 / 路线 / CG / 工坊五视图，共用侧栏外壳。 */
export function StageScreen({ playId, search }: { playId: string; /** 路由上的 query：?view=workshop[&tab=…]（标题页直达工坊）。 */ search?: string }) {
  const directorRef = useRef<VoiceDirector | null>(null);
  if (!directorRef.current) directorRef.current = new VoiceDirector();
  const director = directorRef.current;
  const [, setAudioTick] = useState(0); // 语音状态变化（hold 解除/解锁）触发重渲染
  const [voiceOn, setVoiceOn] = useState(() => readFlag(localStorage, SETTING_VOICE, true));
  /** 本轮写完时摆「（继续）」卡。默认关：点舞台就是续演，与翻下一句同一个动作。 */
  const [continueCard, setContinueCard] = useState(() =>
    readFlag(localStorage, SETTING_CONTINUE_CARD, false),
  );
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [assets, setAssets] = useState<Record<string, string[]>>({});
  /** 当前周目档名：侧栏底部的存档芯片，点它去周目页换一棵故事树。 */
  const [saveName, setSaveName] = useState<string | null>(null);
  /** P6 缓冲换代：token 变化 = 事件缓冲被整段重放；resume 决定快进还是继续流式；
   *  seekTo 是跳转重读的播放头落点（换代后从那句起读，而不是快进到本轮末尾）。 */
  const [rebase, setRebase] = useState<{
    token: number;
    resume: boolean;
    seekTo: ReadPos | null;
  }>({ token: 0, resume: true, seekTo: null });
  /** 谱系代次：每轮、结构操作后自增，把最新的树拉回来。 */
  const [lineageNonce, setLineageNonce] = useState(0);
  /**
   * 从标题页直达工坊（?view=workshop&workshop=1）：工坊是本外壳的一个视图，
   * 顶栏与侧栏跟舞台完全一致（不再有另一个自带顶栏的工坊页）。
   */
  const workshopEntry = workshopConnectionFromQuery(search);
  const [view, setView] = useState<StageView>(() => stageViewFromQuery(search));
  const [workshopTab, setWorkshopTab] = useState(() => stageTabFromQuery(search));

  /**
   * 回到舞台。从标题页直达工坊时（workshop=1）那条连接不 autostart，本地切视图只会
   * 得到一块永远不开演的舞台——所以重挂路由换一条真舞台连接（重挂即 autostart）。
   * 舞台内部切工坊不重连：那条连接本来就在开着。
   */
  const goStage = useCallback((): void => {
    if (workshopEntry) {
      navigate(`/play/${playId}/stage`);
      return;
    }
    setView("stage");
  }, [workshopEntry, playId]);

  /** 侧栏导航：工坊内部就地切；工坊入口模式下切去别的视图要换真舞台连接。 */
  const goView = useCallback(
    (next: StageView): void => {
      if (workshopEntry) {
        // 换一条真舞台连接（重挂即 autostart）并落在目标视图；去舞台不要带 query，
        // 留着 ?view=stage 会让人以为这里还需要一个参数。
        navigate(next === "stage" ? `/play/${playId}/stage` : `/play/${playId}/stage?view=${next}`);
        return;
      }
      setView(next);
    },
    [workshopEntry, playId],
  );
  /** 回顾的第二视图：剧作家的原始历史（同一份内容区，切视图不换外壳）。默认给原始历史。 */
  const [rawHistory, setRawHistory] = useState(true);
  const [historyNonce, setHistoryNonce] = useState(0);
  /** CG 页代次：每有一张图到货就自增——开着这一页时新图直接出现在网格里。 */
  const [cgNonce, setCgNonce] = useState(0);
  /** 路线画布把镜头操作交给侧栏（见 RouteCanvas 的 onControls）。 */
  const [routeControls, setRouteControls] = useState<RouteControls | null>(null);
  const setRouteControlsStable = useCallback((c: RouteControls) => setRouteControls(c), []);
  /** 按住 Ctrl 的快进档：舞台层只报键，播放层管节奏。 */
  const [turbo, setTurbo] = useState(false);
  const toast = useToasts();
  useVisualViewport();
  const generated = useGeneratedAssets();
  // 生图回调要在 socket 建连时就能摸到 playback，但 playback 声明在后面
  const playbackRef = useRef<ReturnType<typeof usePlayback> | null>(null);
  // 阅读位置上报出口：播放层逐字报位置，这里按行首立即 + 行内 1s 节流，服务端再节流落盘
  const readPosRef = useRef<((pos: ReadPos) => void) | null>(null);
  const readPosTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 最近一次已上报的行键与时刻：换行立即发、同行按 1s 节流。 */
  const lastReadKey = useRef<string | null>(null);
  const lastReadAt = useRef(0);
  /** 节流窗口内待发的最后一次上报：卸载时 flush。 */
  const pendingReadRef = useRef<(() => void) | null>(null);
  // 谱系只在这两个导演视图里拉取（打开/操作后/手动刷新），不做每轮广播
  const lineage = useLineage(playId, lineageNonce);
  // 工坊下行消息的订阅表：面板挂载时登记，卸载时注销（与舞台状态机解耦）
  const workshopHandlers = useRef(new Set<(msg: WorkshopInbound) => void>());
  const subscribeWorkshop = useCallback((handler: (msg: WorkshopInbound) => void) => {
    workshopHandlers.current.add(handler);
    return () => {
      workshopHandlers.current.delete(handler);
    };
  }, []);
  const { push: pushToast } = toast;

  const stage = useStageSocket(playId, {
    onAudio: (ready) => director.handleAudio(ready),
    onAudioPending: (pending) => director.markPending(pending.seq, pending.phrase),
    onBeatStart: () => {
      director.beatStarted();
      setLineageNonce((n) => n + 1); // 上一轮的玩家表态进谱系了，选肢的「已选过」要跟上
    },
    onReset: () => director.reset(),
    // 原地改写：缓冲已就地换字，谱系刷新把剧本/路线的标签换成新文本
    onLineEdited: () => setLineageNonce((n) => n + 1),
    // P6 上下文重建：新分支整段到达——播放层复位，谱系视图跟着换
    onRebase: ({ note, playFrom, resumeAt, busy: streaming }) => {
      director.reset();
      setRebase((cur) => ({
        token: cur.token + 1,
        resume: !streaming,
        // 从本轮开头重读：把播放头钉在该轮首句（offset=0），不按终局快进
        seekTo: playFrom === "start" && resumeAt ? resumeAt : null,
      }));
      setLineageNonce((n) => n + 1);
      if (note) pushToast(note, "warn");
      goStage(); // 结构操作后回舞台看结果
    },
    // D6 生图：到货即登记（预解码后淡入），失败只提示——舞台视觉不因图卡住
    onAssets: (list) => generated.add(list),
    onAssetReady: (asset) => {
      generated.add([asset]);
      playbackRef.current?.settleAssets([asset.id]);
      if (asset.type === "cg") setCgNonce((n) => n + 1); // CG 页开着就把它补进网格
    },
    onAssetFailed: (id, message) => {
      playbackRef.current?.settleAssets([id]);
      // 原始错误（状态码、模型名、provider、错误码）不是玩家能用的信息，也不该出现在
      // 玩家界面上；它留给 console，toast 只说发生了什么、玩家下一步能做什么。
      console.warn(`[stage-ai] 生图失败 ${id}: ${message}`);
      pushToast("有一张图没生成出来，已用氛围底色顶上。可到剧目库「设置」里换出图后端。", "warn");
    },
    onWorkshop: (msg) => {
      for (const handler of workshopHandlers.current) handler(msg);
    },
  }, { workshopOnly: workshopEntry });

  // 渲染期回调绑定（N6：置于 stage 声明后，闭包引用才不踩未初始化的 TDZ）
  director.onNotify = () => setAudioTick((t) => t + 1);
  director.onControl = (state) => stage.sendTtsControl(state);

  // 阅读位置上报出口（渲染期绑定）：
  //  · 切到新行（nodeId 变化）→ 立刻发首帧，不等节流；
  //  · 行内打字机逐字推进 → 1s 节流，只发最后一次；
  //  · 卸载时 flush 待发的那次，避免刷新丢掉最后一段进度。
  readPosRef.current = (pos: ReadPos) => {
    const pending = pendingReadRef.current;
    const key = pos.nodeId || String(pos.seq ?? "");
    const last = readPosTimer.current;
    if (last) clearTimeout(last);
    const now = Date.now();
    const sameLine = key === lastReadKey.current;
    const elapsed = now - lastReadAt.current;
    const fire = (): void => {
      readPosTimer.current = null;
      lastReadKey.current = key;
      lastReadAt.current = Date.now();
      pendingReadRef.current = null;
      stage.sendRead(pos);
    };
    pendingReadRef.current = fire;
    if (!sameLine || elapsed >= READ_REPORT_MS) {
      fire();
      return;
    }
    readPosTimer.current = setTimeout(fire, READ_REPORT_MS - elapsed);
  };

  // 导演出口（P6）：senders 在 useStageSocket 内 useCallback 稳定，仅重连后换引用
  const { sendFork: fork, sendJump: jump, sendEdit: edit } = stage;

  /**
   * 路线页上的结构操作做完就回舞台。跳转没有新内容可演、留在原地的话树上的高亮会跟着
   * 挂载点动，玩家只会看到「点了没反应」；分岔也只在舞台上看得见结果。
   * 舞台导演栏不切视图——它本来就在舞台上。
   */
  const routeOps: LineageOps = useMemo(
    () => ({
      jump: (nodeId: string, opts?: { playFrom?: "start" | "end" }) => {
        jump(nodeId, opts);
        goStage();
      },
      fork: (nodeId: string, opts?: { resume?: boolean }) => {
        fork(nodeId, opts);
        goStage();
      },
    }),
    [jump, fork, goStage],
  );


  // 走过的岔路口：玩家在这条线之外已经说过的选择，卡片上打「✓ 已选过」提醒存在多条命运
  const seenChoices = useMemo(
    () =>
      new Set((lineage.view?.nodes ?? []).filter((n) => n.kind === "prompt" && n.text).map((n) => n.text)),
    [lineage.view],
  );

  useEffect(() => {
    api.playDetail(playId).then(setDetail).catch(() => {});
    api.listAssets(playId).then(setAssets).catch(() => {});
    api.listSaves(playId)
      .then((list) => setSaveName(list.find((s) => s.current)?.name ?? null))
      .catch(() => {});
    return () => director.dispose();
  }, [playId]);

  // 阅读位置上报的待发定时器随连接一起走：连接没了就别补发那一帧。
  // 卸载/刷新前把节流窗口里最后一次位置 flush 出去（sendRead 走已建立的连接，页面卸载时尽力而为）。
  useEffect(() => {
    const flush = (): void => {
      if (readPosTimer.current) {
        clearTimeout(readPosTimer.current);
        readPosTimer.current = null;
      }
      pendingReadRef.current?.();
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      if (readPosTimer.current) clearTimeout(readPosTimer.current);
      pendingReadRef.current?.();
    };
  }, []);

  // 语音开关本地态 ↔ 服务端（连接建立/重连/切换时同步；关=停合成省配额）
  useEffect(() => {
    if (!stage.voiceAvailable) return;
    director.setEnabled(voiceOn);
    stage.sendTtsControl({ enabled: voiceOn });
  }, [stage.voiceAvailable, stage.state, voiceOn]);

  const index: AssetIndex | null = useMemo(
    () => (detail ? buildAssetIndex(playId, detail.cast, assets, generated.images) : null),
    [detail, assets, playId, generated.images],
  );

  // 会话记录：这一场说过的所有话——剧作家的台词、玩家的选择与输入、导演注，
  // 不含背景/音效/插图这些布景指令。回看游标与回顾列表读的是它，两处才不会各说各话。
  const transcript = useMemo(() => buildTranscript(lineage.view, stage.lines), [
    lineage.view,
    stage.lines,
  ]);

  // 轮是谱系行级日志上的区间，跟舞台行用同一个 seq 对尺：任意一行反查回它的轮与台词节点，
  // 四原语就有着落点——不用跳到别的视图去找「刚才那一句」。
  const cards = useMemo(() => (lineage.view ? buildBeats(lineage.view, stage.lines) : []), [
    lineage.view,
    stage.lines,
  ]);

  const playback = usePlayback(stage.cues, stage.lines, {
    live: stage.state === "streaming",
    transcript,
    resume: true,
    revision: stage.revision,
    // P6：缓冲被结构性操作整段重放 → 播放层强制归零（换代后快进到新分支末尾）
    resetToken: rebase.token,
    resumeAfterReset: rebase.resume,
    // D5 文字先行 + 语音收尾：自动模式等当前句语音播完再推进
    hold: director.holdsLine(),
    turbo,
    // D6 骨架兜底上界：服务端按生图配置下发，客户端不再自己猜生成要多久
    assetsTtlMs: stage.assetsTtlMs,
    // #3 刷新后回到上次读到的那一句，而不是快进到本轮末尾
    resumeAt: stage.readPos,
    // 跳转重读：换代后从这个落点起读（该轮首句 offset=0）
    seekTo: rebase.seekTo,
    onLineStart: (line) => director.lineStarted(line?.seq, line?.type === "say"),
    onFastForward: () => director.fastForward(),
    onRead: (pos) => readPosRef.current?.(pos),
  });
  playbackRef.current = playback;

  // 轮收束后还要等编排器真正空闲（beat_settled），否则玩家点选项会被「演出进行中」挡回
  const busy = stage.state === "streaming" || stage.state === "connecting" || !stage.settled;
  // D4：先演完再交互——打字机未消费完前不露出停止点（防剧透/防提前发送）
  const lineDone = playback.current === null || playback.shownLength >= playback.current.text.length;
  const panelReady = !busy && playback.exhausted && lineDone;

  // 「继续」的出口形态：默认是点舞台（与翻下一句同一个动作），设置里打开才摆一张卡。
  // pause（轮中截断/空轮报错）永远走点舞台——它是引擎自造的，不是剧本写出来的停止点。
  const affordance = stopAffordance({
    ready: panelReady,
    stopType: stage.stop?.stopType ?? null,
    isNoStop: stage.isNoStop,
    continueCardOn: continueCard,
  });
  const canContinue = affordance.clickToContinue;
  const continued = useRef(false);
  useEffect(() => {
    if (!canContinue) continued.current = false;
  }, [canContinue]);
  const continueBeat = useCallback((): void => {
    // 一次点击只发一条：连点两下第二条会撞上服务端的 engaged，被回一条无来由的报错。
    if (continued.current) return;
    continued.current = true;
    stage.sendContinue();
  }, [stage.sendContinue]);

  /**
   * 玩家刚发出去的那一句：谱系是按需拉取的，最快也要等下一次轮询才把它收进回顾，
   * 中间这几十秒对话框里什么都不换新——看着像「没点上」。先就地把它顶成一条消息。
   *
   * `afterKey` 是发话那一刻显示着的那一行：播放头一动就说明新一轮的台词进场了，
   * 此时谱系迟早会补上这条输入，撤掉回声、交回真正的对话内容。手动点舞台也撤。
   */
  const [echo, setEcho] = useState<{ text: string; afterKey: string | null } | null>(null);
  const echoText = echo && (playback.current?.key ?? null) === echo.afterKey ? echo.text : null;
  const dismissEcho = useCallback((): void => setEcho(null), []);

  const sendChoice = useCallback(
    (index: number): void => {
      const text = stage.stop?.options?.[index]?.text;
      setEcho({ text: `（选择了：${text ?? `选项 ${index + 1}`}）`, afterKey: playbackRef.current?.current?.key ?? null });
      stage.sendChoice(index);
    },
    [stage.stop, stage.sendChoice],
  );

  const sendFree = useCallback(
    (text: string): void => {
      setEcho({ text, afterKey: playbackRef.current?.current?.key ?? null });
      stage.sendFree(text);
    },
    [stage.sendFree],
  );

  // Esc 回到舞台（侧栏是常驻的，不需要「关掉」它）。走 ui/escape.ts 的浮层栈：
  // 输入模态窗开着的那一下归它，视图栏只在自己是栈顶时才认领。
  useEscape(() => goStage(), view !== "stage");

  // 谱系定期拉取：路线视图开着时看得到直播的树；舞台停在停止点上也拉——
  // 此刻这一轮的事件才刚落库，导演栏的锚点要指得准。
  const { reload: reloadLineage } = lineage;
  useEffect(() => {
    if (view === "stage" && !panelReady) return;
    const timer = setInterval(reloadLineage, 2500);
    return () => clearInterval(timer);
  }, [view, panelReady, reloadLineage]);

  /**
   * 这一轮刚演完、按钮刚解禁的那一刻立刻拉一次谱系，不等轮询的 2.5s。
   * 导演栏的「改写 / 重新生成 / 分岔」全都靠谱系节点反查锚点，谱系没跟上就一直灰着——
   * 玩家看到的是「这一轮演完了，但三个按钮都点不动」，而没有任何理由能解释。
   */
  useEffect(() => {
    if (panelReady) reloadLineage();
  }, [panelReady, reloadLineage]);

  // 轮是谱系行级日志上的区间，跟舞台行用同一个 seq 对尺：当前显示行反查回它的轮与台词节点，
  // 四原语就有着落点——不用跳到别的视图去找「刚才那一句」。
  const targets: DirectorTargets = useMemo(() => {
    const line = playback.view;
    const seq = line?.seq ?? null;
    if (!lineage.view) return { beatId: null, lineNodeId: null, lineSeq: seq, lineText: line?.text ?? "" };
    return {
      beatId: beatAtLine(cards, line)?.id ?? null,
      lineNodeId: editableNodeAtLine(lineage.view, line)?.id ?? null,
      lineSeq: seq,
      lineText: line?.text ?? "",
    };
  }, [cards, lineage.view, playback.view]);

  /** 回顾里每条自己落在哪一轮：玩家发来的话没有轮，工具栏上的重来就置灰。 */
  const beatFor = useCallback(
    (entry: TranscriptEntry): string | null =>
      lineage.view ? (beatAtLine(cards, entry)?.id ?? null) : null,
    [cards, lineage.view],
  );

  const voiceState = useCallback((seq: number | null) => director.voiceState(seq), [director]);
  const replay = useCallback(
    (seq: number): void => {
      void director.replay(seq);
    },
    [director],
  );

  const toggleVoice = (): void => {
    const next = !voiceOn;
    setVoiceOn(next);
    writeFlag(localStorage, SETTING_VOICE, next);
  };

  const toggleContinueCard = (): void => {
    const next = !continueCard;
    setContinueCard(next);
    writeFlag(localStorage, SETTING_CONTINUE_CARD, next);
  };

  const unlockVoice = (): void => {
    director.unlock();
    setAudioTick((t) => t + 1);
  };

  // 连接失败这类瞬态提示走 toast：不该在舞台顶上钉一条常驻横幅挡住画面
  const socketError = stage.error;
  useEffect(() => {
    if (socketError) pushToast(socketError, "error");
  }, [socketError, pushToast]);

  // 侧栏的工具段：当前视图自己才有的操作（回顾的第二个视图、路线的镜头）。
  // 导航（舞台/回顾/路线/工坊）归侧栏本体，离开这场戏只有底栏「退出」一个出口。
  const tools = view === "backlog" ? (
    <>
      <div className="side-tools-title">看哪一层</div>
      <div className="seg side-seg" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={!rawHistory}
          className={`seg-btn ${rawHistory ? "" : "active"}`.trim()}
          onClick={() => setRawHistory(false)}
        >
          说过的话
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={rawHistory}
          className={`seg-btn ${rawHistory ? "active" : ""}`.trim()}
          onClick={() => setRawHistory(true)}
          title="剧作家的原始记录"
        >
          原始历史
        </button>
      </div>
      {rawHistory && (
        <button
          type="button"
          className="side-tool-btn"
          onClick={() => setHistoryNonce((n) => n + 1)}
          title="重新拉取（内容还没写进存档）"
        >
          <Icon name="refresh" size={15} />
          刷新
        </button>
      )}
    </>
  ) : view === "route" ? (
    routeControls && (
      <>
        <div className="side-tools-title">镜头</div>
        <div className="side-seg" role="group" aria-label="时间方向">
          <button
            type="button"
            className={`seg-btn ${routeControls.dir === "horizontal" ? "active" : ""}`.trim()}
            onClick={() => routeControls.setDir("horizontal")}
            title="从左到右读时间"
          >
            横向
          </button>
          <button
            type="button"
            className={`seg-btn ${routeControls.dir === "vertical" ? "active" : ""}`.trim()}
            onClick={() => routeControls.setDir("vertical")}
            title="从上到下读时间"
          >
            纵向
          </button>
        </div>
        <div className="side-tool-grid">
          <button type="button" className="side-tool-btn" onClick={routeControls.toRoot} title="回到开头">
            <Icon name="prev" size={15} />
            开头
          </button>
          <button
            type="button"
            className="side-tool-btn"
            onClick={routeControls.toLatest}
            disabled={!routeControls.canGoLatest}
            title="跳到最新"
          >
            <Icon name="locate" size={15} />
            最新
          </button>
          <button type="button" className="side-tool-btn" onClick={routeControls.zoomOut} title="缩小">
            <Icon name="zoomOut" size={15} />
            缩小
          </button>
          <button type="button" className="side-tool-btn" onClick={routeControls.zoomIn} title="放大">
            <Icon name="zoomIn" size={15} />
            放大
          </button>
          <button type="button" className="side-tool-btn wide" onClick={routeControls.fitAll} title="看全树">
            <Icon name="expand" size={15} />
            看全树
          </button>
        </div>
        <p className="side-hint">拖动平移 · 滚轮缩放 · 每张卡右下角就管这一段</p>
      </>
    )
  ) : null;

  return (
    <div className="screen stage-screen">
      <StageShell
        view={view}
        onView={goView}
        title={detail?.play.title ?? playId}
        saveName={saveName}
        onSaves={() => navigate(`/play/${playId}/saves`)}
        onExit={() => navigate(`/play/${playId}`)}
        tools={tools}
      >
        {view === "stage" ? (
          index ? (
            <StageTheater
              visual={playback.visual}
              playback={playback}
              live={stage.state === "streaming"}
              fresh={stage.fresh}
              names={stage.names}
              index={index}
              voiceAvailable={stage.voiceAvailable}
              voiceOn={voiceOn}
              onToggleVoice={toggleVoice}
              busy={busy}
              targets={targets}
              onView={setView}
              onPrompt={stage.sendPrompt}
              onFork={fork}
              onEdit={edit}
              onGenerateCg={(instruction) =>
                stage.send({ type: "generate_cg", ...(instruction ? { instruction } : {}) })
              }
              onReplay={replay}
              voiceState={voiceState}
              playerEcho={echoText}
              onEchoDismiss={dismissEcho}
              onUnlock={unlockVoice}
              onTurbo={setTurbo}
              canContinue={canContinue}
              onContinue={continueBeat}
              overlay={
                /* 回看中屏幕上摆的是历史台词，那一刻的决定早就做过了——
                   选项摆出来会让人以为还能改，点了就是拿旧决定去覆盖新分支。 */
                playback.scrubbed ? null : stage.fresh ? (
                  /* 空树：摆一个「开演」，等玩家按第一下。第一轮不在连接建立时自动开局。 */
                  <div className="choice-overlay" role="group" aria-label="开演">
                    <div className="choices">
                      <button type="button" className="choice" onClick={stage.sendStart}>
                        <Icon name="play" />
                        <span className="choice-text">开演</span>
                      </button>
                    </div>
                  </div>
                ) : panelReady ? (
                  <StopPanel
                    stop={stage.stop}
                    isNoStop={stage.isNoStop}
                    showContinue={affordance.showContinueCard}
                    disabled={busy}
                    seenChoices={seenChoices}
                    onChoice={sendChoice}
                    onFree={sendFree}
                    onContinue={stage.sendContinue}
                    onPolish={(text) => api.polish(playId, text).then(({ text: polished }) => polished)}
                  />
                ) : null
              }
            />
          ) : (
            <div className="overlay">正在连接舞台…</div>
          )
        ) : view === "backlog" ? (          rawHistory ? (
            <HistoryView playId={playId} nonce={historyNonce} />
          ) : (
            <BacklogView
              entries={playback.history}
              names={stage.names}
              headKey={playback.current?.key ?? null}
              busy={busy}
              voiceAvailable={stage.voiceAvailable}
              voiceState={voiceState}
              beatFor={beatFor}
              onSeek={(key) => {
                playback.seek(key);
                setView("stage");
              }}
              onReplay={replay}
              onEdit={edit}
              onFork={fork}
            />
          )
        ) : view === "route" ? (
          <RouteTree
            view={lineage.view}
            error={lineage.error}
            names={stage.names}
            busy={busy}
            onReload={lineage.reload}
            ops={routeOps}
            index={index}
            lines={stage.lines}
            onControls={setRouteControlsStable}
          />
        ) : view === "cg" ? (
          <CgView playId={playId} nonce={cgNonce} />
        ) : (
          <WorkshopPane
            playId={playId}
            tab={workshopTab}
            onTab={setWorkshopTab}
            subscribe={subscribeWorkshop}
            send={stage.send}
            connected={stage.connected}
            voice={{ on: voiceOn, available: stage.voiceAvailable, onToggle: toggleVoice }}
            continueCard={{ on: continueCard, onToggle: toggleContinueCard }}
          />
        )}

        {/* 提示一律走浮层 toast，不占内容区顶部的一条 */}
        <ToastStack toasts={toast.toasts} onDismiss={toast.dismiss} />

        {/* 待注入队列：空则不占地方。排队中的句子能改也能撤 */}
        {view === "stage" && (
          <PromptQueuePanel
            items={stage.queue}
            jobs={stage.pendingJobs}
            onEdit={(id, text) => stage.sendPromptEdit(id, text)}
            onDelete={(id) => stage.sendPromptDelete(id)}
          />
        )}
      </StageShell>
    </div>
  );
}
