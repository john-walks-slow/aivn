import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeneratedAsset, ReadPos } from "@aivn/core";
import { api, type PlayDetail } from "../api.js";
import { navigate } from "../router.jsx";
import {
  useStageSocket,
  type WorkshopInbound,
} from "../stage/useStageSocket.js";
import {
  usePlayback,
  VoiceDirector,
  buildAssetIndex,
  type AssetIndex,
  useGeneratedAssets,
  BacklogView,
  StageTheater,
  type DirectorTargets,
  type StageView,
  stageTabFromQuery,
  stageViewFromQuery,
  workshopConnectionFromQuery,
  Icon,
  buildScriptFeed,
  buildTranscript,
  type TranscriptEntry,
  ToastStack,
  useToasts,
  StopPanel,
  stopAffordance,
  readFlag,
  writeFlag,
  SETTING_VOICE,
  StageModes,
  useVisualViewport,
  useEscape,
} from "@aivn/stage";
import { HistoryView } from "./HistoryView.js";
import {
  RouteTree,
  useLineage,
  type LineageOps,
} from "../stage/LineagePanel.js";
import { CgView } from "../stage/CgView.js";
import type { RouteControls } from "../stage/RouteCanvas.js";
import { StagePanel } from "../stage/StagePanel.js";
import { useLeaveGuard } from "../workshop/dirtyGuard.js";
import { beatAtLine, buildBeats, editableNodeAtLine } from "../stage/beats.js";
import { PromptQueuePanel, hasPendingWork } from "../stage/PromptQueuePanel.js";
import { WorkshopPane } from "../workshop/WorkshopPane.js";

/** 阅读位置上报的防抖窗口：打字机逐字推进，1s 内只发最后一次位置。 */
const READ_REPORT_MS = 1000;

/** 演出屏：舞台（视觉层+打字机+导演栏）/ 回顾 / 路线 / CG / 工坊五视图，共用侧栏外壳。 */
export function StageScreen({
  playId,
  search,
}: {
  playId: string;
  /** 路由上的 query：?view=workshop[&tab=…]（标题页直达工坊）。 */ search?: string;
}) {
  const directorRef = useRef<VoiceDirector | null>(null);
  if (!directorRef.current) directorRef.current = new VoiceDirector();
  const director = directorRef.current;
  const [, setAudioTick] = useState(0); // 语音状态变化（hold 解除/解锁）触发重渲染
  const [voiceOn, setVoiceOn] = useState(() =>
    readFlag(localStorage, SETTING_VOICE, true),
  );
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [assets, setAssets] = useState<Record<string, string[]>>({});
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
  const [workshopTab, setWorkshopTab] = useState(() =>
    stageTabFromQuery(search),
  );

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
        navigate(
          next === "stage"
            ? `/play/${playId}/stage`
            : `/play/${playId}/stage?view=${next}`,
        );
        return;
      }
      setView(next);
    },
    [workshopEntry, playId],
  );
  /**
   * 回顾的第二视图：剧作家的原始历史（同一份内容区，切视图不换外壳）。
   * 默认落在**台词**那一栏：点「Log」的是玩家，他要看的是自己走过的对话；
   * 「原文」是排查用的快照，还得等一轮真生成完才有内容——默认给它等于开门见空态。
   * （独立检视与 e2e 都提过这一条，2026-10-10 改。）
   */
  const [rawHistory, setRawHistory] = useState(false);
  const [historyNonce, setHistoryNonce] = useState(0);
  /** CG 页代次：每有一张图到货就自增——开着这一页时新图直接出现在网格里。 */
  const [cgNonce, setCgNonce] = useState(0);
  /** 路线画布把镜头操作交给侧栏（见 RouteCanvas 的 onControls）。 */
  const [routeControls, setRouteControls] = useState<RouteControls | null>(
    null,
  );
  const setRouteControlsStable = useCallback(
    (c: RouteControls) => setRouteControls(c),
    [],
  );
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
  // 挂在行上的插图（回看中生图的旁注）：那一行显示时它就是画面上的图。
  // 同一行挂过多次取最新那张——重画一张就是换一张。
  const cgByNode = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of lineage.view?.nodes ?? []) {
      const latest = node.cgs.at(-1);
      if (latest) map.set(node.id, latest);
    }
    return map;
  }, [lineage.view]);
  // 工坊下行消息的订阅表：面板挂载时登记，卸载时注销（与舞台状态机解耦）
  const workshopHandlers = useRef(new Set<(msg: WorkshopInbound) => void>());
  const subscribeWorkshop = useCallback(
    (handler: (msg: WorkshopInbound) => void) => {
      workshopHandlers.current.add(handler);
      return () => {
        workshopHandlers.current.delete(handler);
      };
    },
    [],
  );
  // 手动生图结果监听（工坊手动生图对话框用）
  type ImageResult =
    | { target: string; ok: true; url: string; path: string }
    | { target: string; ok: false; message: string };
  const imageResultHandlers = useRef(new Set<(res: ImageResult) => void>());
  const subscribeImageResult = useCallback(
    (handler: (res: ImageResult) => void) => {
      imageResultHandlers.current.add(handler);
      return () => {
        imageResultHandlers.current.delete(handler);
      };
    },
    [],
  );
  // 素材到货（舞台那边的引用即导入、助手的导入、后台出图）：工坊的面板拿它刷新自己的列表
  const assetReadyHandlers = useRef(new Set<(asset: GeneratedAsset) => void>());
  const subscribeAssetReady = useCallback(
    (handler: (asset: GeneratedAsset) => void) => {
      assetReadyHandlers.current.add(handler);
      return () => {
        assetReadyHandlers.current.delete(handler);
      };
    },
    [],
  );
  /** 角色页「管立绘」的落点：素材页滚到哪个主体。nonce 让同一个 id 再点一次也生效。 */
  const [spriteFocus, setSpriteFocus] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const manageSprites = useCallback((id: string) => {
    setWorkshopTab("assets");
    setSpriteFocus((cur) => ({ id, nonce: (cur?.nonce ?? 0) + 1 }));
  }, []);
  const { push: pushToast } = toast;
  /** 当前视图：offlineAction 要按视图分流，而它是 useStageSocket 的入参（拿不到后面的 stage）。 */
  const viewRef = useRef(view);
  viewRef.current = view;
  /**
   * 连接没就位时玩家按了动作：舞台没有常驻状态带，静默丢弃等于「点了没反应」。
   * 工坊例外——那边内容区顶上已经挂着常驻的「连接断了」横幅，再弹一次只是盖在它上面重复。
   */
  const offlineAction = useCallback(() => {
    if (viewRef.current === "workshop") return;
    pushToast("还没连上服务端，正在重连…", "error");
  }, [pushToast]);

  const restartRequested = new URLSearchParams(search ?? "").get("new") === "1";
  const restartSentRef = useRef(false);
  const stage = useStageSocket(
    playId,
    {
      onSendDropped: offlineAction,
      onAudio: (ready) => director.handleAudio(ready),
      onAudioPending: (pending) =>
        director.markPending(pending.seq),
      onAudioFailed: (failed) => director.audioFailed(failed.seq),
      onBeatStart: () => {
        director.beatStarted();
        setLineageNonce((n) => n + 1); // 上一轮的玩家表态进谱系了，选肢的「已选过」要跟上
      },
      onReset: () => director.reset(),
      // 原地改写：缓冲已就地换字，谱系刷新把剧本/路线的标签换成新文本
      onLineEdited: (_nodeId, _text, seq) => {
        // 台词换了，这一行台账里那份音频就是旧词的：作废，重听会按新台词补生成
        director.forgetLine(seq);
        setLineageNonce((n) => n + 1);
      },
      // 回看中生图：图挂上了某一行，谱系刷新把那张图贴到那一行上
      onCgAttached: () => setLineageNonce((n) => n + 1),
      // P6 上下文重建：新分支整段到达——播放层复位，谱系视图跟着换
      onRebase: ({ note, playFrom, resumeAt, busy: streaming, keepView }) => {
        director.reset();
        setRebase((cur) => ({
          token: cur.token + 1,
          resume: !streaming,
          // 从本轮开头重读：把播放头钉在该轮首句（offset=0），不按终局快进
          seekTo: playFrom === "start" && resumeAt ? resumeAt : null,
        }));
        setLineageNonce((n) => n + 1);
        // 普通结构性跳转（顺着原路继续、跳到这里、开新分支等）属于常规交互流向，界面和路线本身就是反馈，不弹黄色警告 toast。
        // 仅在属于真正异常/退回重试（如判废重演、回退）时提示用户。
        if (note && (note.includes("没有写出") || note.includes("退回") || note.includes("失败"))) {
          pushToast(note, "warn");
        }
        // 删除是在路线里整理分支：树上少一张卡就是反馈，不把玩家拽回舞台
        if (!keepView) goStage();
      },
      // D6 生图：到货即登记（预解码后淡入），失败只提示——舞台视觉不因图卡住
      onAssets: (list) => generated.add(list),
      onAssetReady: (asset) => {
        generated.add([asset]);
        playbackRef.current?.settleAssets([asset.id]);
        if (asset.type === "cg") setCgNonce((n) => n + 1); // CG 页开着就把它补进网格
        for (const handler of assetReadyHandlers.current) handler(asset);
        // 立绘到货 = 立绘目录里多了一张、素材表里多了一条声明（取景/体量/对齐都是出图那一刻写进去的）。
        // 重拉这两份，舞台才会按新声明摆位——不重拉的话新差分只能按缺省站，与声明的体量对不上。
        // BGM 到货同理：`<scene bgm="id">` 正是拿这张素材列表寻址的，不重拉的话它会一直按缺素材降级静音，
        // 直到用户整页刷新。两者的理由不同，所以条件按类型分开写而不是图省事塞进同一支。
        if (asset.type === "sprite" || asset.type === "bgm") {
          api
            .playDetail(playId)
            .then(setDetail)
            .catch(() => {});
          api
            .listAssets(playId)
            .then(setAssets)
            .catch(() => {});
        }
      },
      onAssetFailed: (id, message) => {
        playbackRef.current?.settleAssets([id]);
        // 原始错误（状态码、模型名、provider、错误码）不是玩家能用的信息，也不该出现在
        // 玩家界面上；它留给 console，toast 只说发生了什么、玩家下一步能做什么。
        console.warn(`[aivn] 生图失败 ${id}: ${message}`);
        pushToast(
          "有一张图没生成出来，已用氛围底色顶上。可在「设置」里换出图后端。",
          "warn",
        );
      },
      onWorkshop: (msg) => {
        for (const handler of workshopHandlers.current) handler(msg);
      },
      onImageResult: (res) => {
        for (const handler of imageResultHandlers.current) handler(res);
      },
    },
    { workshopOnly: workshopEntry, restartOnOpen: restartRequested },
  );

  useEffect(() => {
    if (!restartRequested || restartSentRef.current) return;
    restartSentRef.current = true;
    window.history.replaceState(null, "", `${location.pathname}#${location.hash.replace(/\?new=1$/, "")}`);
  }, [playId, restartRequested]);

  // 渲染期回调绑定（N6：置于 stage 声明后，闭包引用才不踩未初始化的 TDZ）
  director.onNotify = () => setAudioTick((t) => t + 1);
  director.onControl = (state) => stage.sendTtsControl(state);
  // 重听点在没有音频的行上 → 请服务端按当时的台词补生成（生成过的整句命中缓存，秒回）
  director.onRequestVoice = (seq) => stage.sendVoiceRequest(seq);

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
  const {
    sendFork: fork,
    sendJump: jump,
    sendEdit: edit,
    sendDelete: drop,
  } = stage;

  /**
   * 路线页上的三个动词。
   *
   * 跳转与重写做完就回舞台：跳转没有新内容可演、留在原地的话树上的高亮会跟着挂载点动，
   * 玩家只会看到「点了没反应」；重写的新内容也只在舞台上看得见。
   * 删除反过来——留在路线视图（树上少一张卡就是反馈），服务端那条重建带 `keepView` 把
   * 舞台的 rebase 回调拦下，不把正在整理分支的玩家拽走。
   *
   * 重写的指令与舞台导演栏同一条路：跟着 fork 一起发，它是重演那一轮的第一条输入——
   * 交代什么方向，重写的这一轮就照着写什么，不是先重写、下一轮才补上。锚点也同一套：
   * 退到本轮之前那一点，并点名被顶掉的那一拍（本轮由玩家的一句话开头时，那句话由服务端
   * 带进新枝，剧作家照旧看得到「玩家说了什么」）。
   */
  const routeOps: LineageOps = useMemo(
    () => ({
      jump: (nodeId: string, opts?: { playFrom?: "start" | "end" }) => {
        jump(nodeId, opts);
        goStage();
      },
      rewrite: (
        anchor: string,
        opts?: { replaced?: string; instruction?: string },
      ) => {
        fork(anchor, {
          resume: true,
          ...(opts?.replaced ? { replaced: opts.replaced } : {}),
          ...(opts?.instruction ? { instruction: opts.instruction } : {}),
        });
        goStage();
      },
      remove: (nodeId: string) => drop(nodeId),
    }),
    [jump, fork, drop, goStage],
  );

  // 走过的岔路口：玩家在这条线之外已经说过的选择，卡片上打「✓ 已选过」提醒存在多条命运
  const seenChoices = useMemo(
    () =>
      new Set(
        (lineage.view?.nodes ?? [])
          .filter((n) => n.kind === "prompt" && n.text)
          .map((n) => n.text),
      ),
    [lineage.view],
  );

  useEffect(() => {
    api
      .playDetail(playId)
      .then(setDetail)
      .catch(() => {});
    api
      .listAssets(playId)
      .then(setAssets)
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
    () =>
      detail
        ? buildAssetIndex(
            playId,
            assets,
            generated.images,
            detail.manifest ?? {},
            detail.cast,
          )
        : null,
    [detail, assets, playId, generated.images],
  );

  // 会话记录：这一场说过的所有话——剧作家的台词、玩家的选择与输入、导演注，
  // 不含背景/音效/插图这些布景指令。回看游标与回顾列表读的是它，两处才不会各说各话。
  // revision 进依赖：缓冲是原地变更的稳定引用，谱系不轮询的窗口里（舞台视图生成中）
  // 刚落进缓冲的 input 行也要立刻进记录——「回顾 0 延迟见输入」靠的是它。
  const transcript = useMemo(
    () => buildTranscript(lineage.view, stage.lines),
    [lineage.view, stage.lines, stage.revision],
  );


  // 轮是谱系行级日志上的区间，跟舞台行用同一个 seq 对尺：任意一行反查回它的轮与台词节点，
  // 四原语就有着落点——不用跳到别的视图去找「刚才那一句」。
  const cards = useMemo(
    () => (lineage.view ? buildBeats(lineage.view, stage.lines) : []),
    [lineage.view, stage.lines],
  );

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
    onLineStart: (line) =>
      director.lineStarted(line?.seq, line?.type === "say"),
    onFastForward: () => director.fastForward(),
    onRead: (pos) => readPosRef.current?.(pos),
    cgByNode,
  });
  playbackRef.current = playback;

  // 初始连接或历史事件流尚未拉齐：处于加载期，展示 spinner 且禁用舞台按钮与停止点
  const loading = stage.syncing || stage.state === "connecting";
  // 轮收束后还要等编排器真正空闲（beat_settled），否则玩家点选项会被「演出进行中」挡回
  const busy =
    loading ||
    stage.state === "streaming" ||
    !stage.settled;
  // D4：先演完再交互——打字机未消费完前不露出停止点（防剧透/防提前发送）
  const lineDone =
    playback.current === null ||
    playback.shownLength >= playback.current.text.length;
  const panelReady = !busy && playback.exhausted && lineDone;

  // 「继续」的出口只有点舞台（与翻下一句同一个动作）；pause（轮中截断/空轮报错）
  // 同样走它——那是引擎自造的，不是剧本写出来的停止点。
  const canContinue = stopAffordance({
    ready: panelReady,
    stopType: stage.stop?.stopType ?? null,
    isNoStop: stage.isNoStop,
  });
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

  // 选择/自由输入没有本地回声：服务端在**接受**动作那一刻广播 player_input 事件，
  // 缓冲里多出的那行就是回执——立刻可见，回看/回顾/第二客户端/重连同享同一行
  // （「立刻顶上」由 director 的 shouldAutoStart 回执例外保证，被拒的动作则根本没有事件）。

  // Esc 回到舞台（侧栏是常驻的，不需要「关掉」它）。走 ui/escape.ts 的浮层栈：
  // 输入模态窗开着的那一下归它，视图栏只在自己是栈顶时才认领。
  useEscape(() => guardLeave(goStage), view !== "stage");

  // 谱系定期拉取：路线视图开着时看得到直播的树；舞台停在停止点上也拉——
  // 此刻这一轮的事件才刚落库，导演栏的锚点要指得准。
  const { reload: reloadLineage } = lineage;
  /** Esc 回舞台也要过未保存那一道闸（登记处挂在 App 外层，这里读得到）。 */
  const guardLeave = useLeaveGuard();
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
    const beat = lineage.view ? beatAtLine(cards, line) : null;
    if (!lineage.view) {
      return {
        beatId: null,
        beatNodeId: null,
        lineNodeId: null,
        lineSeq: seq,
        // 改写初值给原文（带语气标记）：拿上屏文本当初值，一改就把标记吃掉了
        lineText: line?.raw ?? line?.text ?? "",
      };
    }
    return {
      beatId: beat?.forkFromId ?? null,
      beatNodeId: beat?.id ?? null,
      lineNodeId: editableNodeAtLine(lineage.view, line)?.id ?? null,
      lineSeq: seq,
      lineText: line?.raw ?? line?.text ?? "",
    };
  }, [cards, lineage.view, playback.view]);

  /** 回顾里每条自己落在哪一轮：玩家发来的话没有轮，工具栏上的重来就置灰。 */
  const beatFor = useCallback(
    (entry: TranscriptEntry): { anchor: string; replaced: string } | null => {
      const card = lineage.view ? beatAtLine(cards, entry) : null;
      return card ? { anchor: card.forkFromId, replaced: card.id } : null;
    },
    [cards, lineage.view],
  );

  const voiceState = useCallback(
    (seq: number | null) => director.voiceState(seq),
    [director],
  );
  // 重听：台账里有的直接播；没有的先补生成，到齐再播（判断在导演里，见 requestReplay）
  const replay = useCallback(
    (seq: number): void => {
      director.requestReplay(seq);
    },
    [director],
  );

  const toggleVoice = (): void => {
    const next = !voiceOn;
    setVoiceOn(next);
    writeFlag(localStorage, SETTING_VOICE, next);
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

  const playTitle = detail?.play.title ?? playId;
  const exitToTitle = (): void => navigate(`/play/${playId}`);

  // 回顾抽屉头上的分段：台词（玩家视角）与原始输出（剧作家写下的原文，排查用）
  const backlogActions = (
    <>
      <div className="seg seg-glass" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={!rawHistory}
          className={`seg-btn${rawHistory ? "" : " active"}`}
          onClick={() => setRawHistory(false)}
          title="这一场演到现在，剧本上落下的每一行（台词与舞台指令）"
        >
          剧本
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={rawHistory}
          className={`seg-btn${rawHistory ? " active" : ""}`}
          onClick={() => setRawHistory(true)}
          title="剧作家写下的原文"
        >
          原文
        </button>
      </div>
      {rawHistory && (
        <button
          type="button"
          className="panel-icon-btn"
          onClick={() => setHistoryNonce((n) => n + 1)}
          title="重新载入"
          aria-label="重新载入"
        >
          <Icon name="refresh" size={15} />
        </button>
      )}
    </>
  );

  // 路线面板头上的镜头控制：原先挤在侧栏里，现在落到画布顶上
  const routeActions = routeControls && (
    <>
      <div className="seg seg-glass" role="group" aria-label="时间方向">
        <button
          type="button"
          className={`seg-btn${routeControls.dir === "horizontal" ? " active" : ""}`}
          onClick={() => routeControls.setDir("horizontal")}
          title="从左到右读时间"
        >
          横向
        </button>
        <button
          type="button"
          className={`seg-btn${routeControls.dir === "vertical" ? " active" : ""}`}
          onClick={() => routeControls.setDir("vertical")}
          title="从上到下读时间"
        >
          纵向
        </button>
      </div>
      <div className="panel-btn-group">
        <button
          type="button"
          className="panel-icon-btn"
          onClick={routeControls.toRoot}
          title="回到开头"
        >
          <Icon name="prev" size={15} />
        </button>
        <button
          type="button"
          className="panel-icon-btn"
          onClick={routeControls.toLatest}
          disabled={!routeControls.canGoLatest}
          title="跳到最新"
        >
          <Icon name="locate" size={15} />
        </button>
        <button
          type="button"
          className="panel-icon-btn"
          onClick={routeControls.zoomOut}
          title="缩小"
        >
          <Icon name="zoomOut" size={15} />
        </button>
        <button
          type="button"
          className="panel-icon-btn"
          onClick={routeControls.zoomIn}
          title="放大"
        >
          <Icon name="zoomIn" size={15} />
        </button>
        <button
          type="button"
          className="panel-icon-btn"
          onClick={routeControls.fitAll}
          title="看全树"
        >
          <Icon name="expand" size={15} />
        </button>
      </div>
    </>
  );

  const actorNames = useMemo(() => {
    const map: Record<string, string> = { ...stage.names };
    for (const c of detail?.cast ?? []) {
      if (c.id && c.name) map[c.id] = c.name;
    }
    return map;
  }, [detail, stage.names]);

  // 剧本视图：台词 + 谱系里的布景指令（换景/立绘/音效/插图/效果/停止点）按演出顺序铺开。
  // 名字表给它，立绘行的 id 才显示成人名。
  const scriptFeed = useMemo(
    () => buildScriptFeed(lineage.view, transcript, actorNames),
    [lineage.view, transcript, actorNames],
  );

  /**
   * 待注入队列只有一份数据，落点两处：舞台塞进台词条底缘那格状态位，工坊贴内容区底部一条。
   * 折叠态：包含浅图标与 spinner（文本生成中），下一句可用时 spinner 变成跳动光标。
   */
  const isLineDone =
    playback.current !== null && playback.shownLength >= playback.current.text.length;
  const isNextReady = isLineDone && (!playback.exhausted || canContinue);

  const pendingQueue = (variant: "dialog" | "dock") =>
    hasPendingWork(stage.queue, stage.pendingJobs, {
      live: stage.state === "streaming",
      nextReady: variant === "dialog" ? isNextReady : false,
    }) ? (
      <PromptQueuePanel
        variant={variant}
        items={stage.queue}
        jobs={stage.pendingJobs}
        onEdit={(id, text) => stage.sendPromptEdit(id, text)}
        onDelete={(id) => stage.sendPromptDelete(id)}
        onDismissJob={(jobId) => stage.sendPendingDismiss(jobId)}
        nextReady={variant === "dialog" ? isNextReady : false}
        live={stage.state === "streaming"}
      />
    ) : null;

  if (view === "workshop") {
    return (
      <div className="screen stage-screen studio-screen">
        <WorkshopPane
          playId={playId}
          playTitle={playTitle}
          onBackToStage={goStage}
          tab={workshopTab}
          onTab={setWorkshopTab}
          subscribe={subscribeWorkshop}
          subscribeImageResult={subscribeImageResult}
          subscribeAssetReady={subscribeAssetReady}
          spriteFocus={spriteFocus}
          onManageSprites={manageSprites}
          send={stage.send}
          connected={stage.connected}
          queue={pendingQueue("dock")}
        />
        <ToastStack toasts={toast.toasts} onDismiss={toast.dismiss} />
      </div>
    );
  }

  return (
    <div className={`screen stage-screen${view !== "stage" ? " panel-open" : ""}`}>
      {index ? (
        <StageTheater
          visual={playback.visual}
          playback={playback}
          live={stage.state === "streaming"}
          loading={loading}
          fresh={stage.fresh}
          names={actorNames}
          voiceCast={stage.voiceCast}
          index={index}
          voiceAvailable={stage.voiceAvailable}
          voiceOn={voiceOn}
          onToggleVoice={toggleVoice}
          busy={busy}
          targets={targets}
          onView={goView}
          onExit={exitToTitle}
          onPrompt={stage.sendPrompt}
          onFork={fork}
          onEdit={edit}
          onGenerateCg={(instruction, opts) =>
            stage.send({
              type: "generate_cg",
              ...(instruction ? { instruction } : {}),
              ...(opts?.referenceCharacters?.length
                ? { referenceCharacters: opts.referenceCharacters }
                : {}),
              ...(opts?.useHistory !== undefined
                ? { useHistory: opts.useHistory }
                : {}),
              // null 也要发出去：那是「在回看但这一行还没进谱系」，服务端据此明确拒绝
              ...(opts?.anchorNodeId !== undefined
                ? { anchorNodeId: opts.anchorNodeId }
                : {}),
            })
          }
          onReplay={replay}
          voiceState={voiceState}
          onUnlock={unlockVoice}
          onTurbo={setTurbo}
          /* 限制级通道的手动开关（导演栏最后一枚）：拨一下立刻作用于这一局，服务端同时写回 play.json */
          nsfwChannel={{
            active: stage.nsfw,
            onToggle: (active) =>
              api.setNsfw(playId, active).catch((e: Error) => toast.push(e.message, "warn")),
          }}
          canContinue={canContinue}
          onContinue={continueBeat}
          onNotify={(text) => toast.push(text, "warn")}
          /* 待注入队列的指示符 + 触发器就长在台词条底缘那格状态位上（原先画 spinner 的地方） */
          dialogStatus={pendingQueue("dialog")}
          overlay={
            /* 回看中屏幕上摆的是历史台词，那一刻的决定早就做过了——
               选项摆出来会让人以为还能改，点了就是拿旧决定去覆盖新分支。 */
            playback.scrubbed ? null : stage.fresh ? (
              /* 空树：摆一个「开始」，等玩家按第一下。第一轮不在连接建立时自动开局。 */
              <div className="choice-overlay" role="group" aria-label="开始">
                <button
                  type="button"
                  className="choice choice-start"
                  onClick={stage.sendStart}
                >
                  <span className="choice-num">
                    <Icon name="play" size={13} />
                  </span>
                  <span className="choice-text">开始故事</span>
                </button>
              </div>
            ) : panelReady ? (
              <StopPanel
                stop={stage.stop}
                isNoStop={stage.isNoStop}
                disabled={busy}
                seenChoices={seenChoices}
                onChoice={stage.sendChoice}
                onFree={stage.sendFree}
                onPolish={(text) =>
                  api
                    .polish(playId, text)
                    .then(({ text: polished }) => polished)
                }
              />
            ) : null
          }
        />
      ) : (
        <div className="stage-connecting">
          <span className="stage-connecting-spinner" aria-hidden />
          正在连接…
        </div>
      )}

      {/* 舞台左上角：两段式模式切换（舞台 ⇄ 工坊）+ 常驻模式状态（NSFW/静音/Auto） */}
      {view === "stage" && (
        <div className="stage-top-left-cluster">
          <div
            className="stage-view-segmented"
            role="tablist"
            aria-label="模式切换"
          >
            <button
              type="button"
              className="stage-seg-btn is-active"
              disabled={!index || loading}
              onClick={() => setView("stage")}
              title="沉浸舞台模式"
              aria-selected={true}
            >
              <Icon name="drama" size={13} />
              <span>舞台</span>
            </button>
            <button
              type="button"
              className="stage-seg-btn"
              disabled={!index || loading}
              onClick={() => setView("workshop")}
              title="创作工坊模式"
              aria-selected={false}
            >
              <Icon name="workshop" size={13} />
              <span>工坊</span>
            </button>
          </div>
          <StageModes
            nsfw={stage.nsfw}
            muted={stage.voiceAvailable && !voiceOn}
            auto={playback.auto}
          />
        </div>
      )}

      {view === "backlog" && (
        <StagePanel
          variant="drawer"
          title="回顾"
          subtitle={playTitle}
          actions={backlogActions}
          onClose={goStage}
        >
          {rawHistory ? (
            <HistoryView playId={playId} nonce={historyNonce} />
          ) : (
            <BacklogView
              entries={playback.history}
              feed={scriptFeed}
              names={actorNames}
              voiceCast={stage.voiceCast}
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
          )}
        </StagePanel>
      )}

      {view === "route" && (
        <StagePanel
          variant="full"
          className="route-panel"
          title="路线"
          subtitle={playTitle}
          actions={routeActions}
          onClose={goStage}
        >
          <RouteTree
            view={lineage.view}
            error={lineage.error}
            names={actorNames}
            busy={busy}
            onReload={lineage.reload}
            ops={routeOps}
            index={index}
            lines={stage.lines}
            onControls={setRouteControlsStable}
          />
        </StagePanel>
      )}

      {view === "cg" && (
        <StagePanel
          variant="full"
          title="画廊"
          subtitle={playTitle}
          onClose={goStage}
        >
          <CgView
            playId={playId}
            nonce={cgNonce}
            onBackToStage={goStage}
            onOpenWorkshop={() => {
              setWorkshopTab("assets");
              goView("workshop");
            }}
          />
        </StagePanel>
      )}

      <ToastStack toasts={toast.toasts} onDismiss={toast.dismiss} />
    </div>
  );
}
