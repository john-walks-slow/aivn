import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type PlayDetail } from "../api.js";
import { navigate } from "../router.jsx";
import { useStageSocket, type WorkshopInbound } from "../stage/useStageSocket.js";
import { usePlayback } from "../stage/director.js";
import { VoiceDirector } from "../stage/audio.js";
import { buildAssetIndex, type AssetIndex } from "../stage/assets.js";
import { useGeneratedAssets } from "../stage/generatedAssets.js";
import { BacklogView, StageTheater, type DirectorTargets, type StageView } from "../stage/StageTheater.js";
import { GameBar } from "../stage/GameBar.js";
import { RouteTree, useLineage, type LineageOps } from "../stage/LineagePanel.js";
import { beatAtLine, buildBeats, editableNodeAtLine } from "../stage/beats.js";
import { buildTranscript, type TranscriptEntry } from "../stage/transcript.js";
import { ToastStack, useToasts } from "../stage/toast.js";
import { StopPanel } from "../stage/StopPanel.js";
import { PromptQueuePanel } from "../stage/PromptQueuePanel.js";
import { useVisualViewport } from "../stage/viewport.js";
import { WorkshopPanel, type WorkshopMode } from "../workshop/WorkshopPanel.js";

/** 演出屏：舞台（视觉层+打字机+导演栏）/ 回顾 / 路线三视图 + 停止点面板。 */
export function StageScreen({ playId }: { playId: string }) {
  const directorRef = useRef<VoiceDirector | null>(null);
  if (!directorRef.current) directorRef.current = new VoiceDirector();
  const director = directorRef.current;
  const [, setAudioTick] = useState(0); // 语音状态变化（hold 解除/解锁）触发重渲染
  const [voiceOn, setVoiceOn] = useState(() => localStorage.getItem("stage-voice") !== "0");
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [assets, setAssets] = useState<Record<string, string[]>>({});
  /** 当前周目档名：顶栏上的存档芯片，点它去周目页换一棵故事树。 */
  const [saveName, setSaveName] = useState<string | null>(null);
  const [view, setView] = useState<StageView>("stage");
  /** P6 缓冲换代：token 变化 = 事件缓冲被整段重放；resume 决定快进还是继续流式。 */
  const [rebase, setRebase] = useState({ token: 0, resume: true });
  /** 谱系代次：每轮、结构操作后自增，把最新的树拉回来。 */
  const [lineageNonce, setLineageNonce] = useState(0);
  const [workshop, setWorkshop] = useState<WorkshopMode | null>(null);
  /** 操作条常驻：舞台上有几个能点的键，藏起来等于让玩家猜。H 手动收起做沉浸模式，仅此一种隐藏途径。 */
  const [chrome, setChrome] = useState(true);
  /** 按住 Ctrl 的快进档：舞台层只报键，播放层管节奏。 */
  const [turbo, setTurbo] = useState(false);
  const toast = useToasts();
  useVisualViewport();
  const generated = useGeneratedAssets();
  // 生图回调要在 socket 建连时就能摸到 playback，但 playback 声明在后面
  const playbackRef = useRef<ReturnType<typeof usePlayback> | null>(null);
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
    onBeatStart: () => {
      director.beatStarted();
      setLineageNonce((n) => n + 1); // 上一轮的玩家表态进谱系了，选肢的「已选过」要跟上
    },
    onReset: () => director.reset(),
    // 原地改写：缓冲已就地换字，谱系刷新把剧本/路线的标签换成新文本
    onLineEdited: () => setLineageNonce((n) => n + 1),
    // P6 上下文重建：新分支整段到达——播放层复位，谱系视图跟着换
    onRebase: ({ note, busy: streaming }) => {
      director.reset();
      setRebase((cur) => ({ token: cur.token + 1, resume: !streaming }));
      setLineageNonce((n) => n + 1);
      if (note) pushToast(note, "warn");
      setView("stage"); // 结构操作后回舞台看结果
    },
    // D6 生图：到货即登记（预解码后淡入），失败只提示——舞台视觉不因图卡住
    onAssets: (list) => generated.add(list),
    onAssetReady: (asset) => {
      generated.add([asset]);
      playbackRef.current?.settleAssets([asset.id]);
    },
    onAssetFailed: (id, message) => {
      playbackRef.current?.settleAssets([id]);
      pushToast(`生图失败：${message}`, "warn");
    },
    onWorkshop: (msg) => {
      for (const handler of workshopHandlers.current) handler(msg);
    },
  });

  // 渲染期回调绑定（N6：置于 stage 声明后，闭包引用才不踩未初始化的 TDZ）
  director.onNotify = () => setAudioTick((t) => t + 1);
  director.onControl = (state) => stage.sendTtsControl(state);

  // 导演出口（P6）：senders 在 useStageSocket 内 useCallback 稳定，仅重连后换引用
  const { sendFork: fork, sendJump: jump, sendEdit: edit } = stage;
  const ops: LineageOps = useMemo(() => ({ jump, fork }), [jump, fork]);


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

  // 语音开关本地态 ↔ 服务端（连接建立/重连/切换时同步；关=停合成省配额）
  useEffect(() => {
    if (!stage.voiceAvailable) return;
    director.setEnabled(voiceOn);
    stage.sendTtsControl({ enabled: voiceOn });
  }, [stage.voiceAvailable, stage.state, voiceOn]);

  const index: AssetIndex | null = useMemo(
    () => (detail ? buildAssetIndex(playId, detail.play, assets, generated.images) : null),
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
    onLineStart: (line) => director.lineStarted(line?.seq, line?.type === "say"),
    onFastForward: () => director.fastForward(),
  });
  playbackRef.current = playback;

  // 轮收束后还要等编排器真正空闲（beat_settled），否则玩家点选项会被「演出进行中」挡回
  const busy = stage.state === "streaming" || stage.state === "connecting" || !stage.settled;
  // D4：先演完再交互——打字机未消费完前不露出停止点（防剧透/防提前发送）
  const lineDone = playback.current === null || playback.shownLength >= playback.current.text.length;
  const panelReady = !busy && playback.exhausted && lineDone;

  // 「继续」不再单列按钮：等新内容时（pause 停止点）点舞台即开新轮，生成中沿用同一套 pending 反馈。
  const canContinue = panelReady && stage.stop?.stopType === "pause";
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

  // 三个浮层都是 z-index 压在顶栏之上的，关掉它们的自然动作是 Esc。
  useEffect(() => {
    if (view === "stage" && !workshop) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (workshop) setWorkshop(null);
      else setView("stage");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, workshop]);

  // 谱系定期拉取：路线视图开着时看得到直播的树；舞台停在停止点上也拉——
  // 此刻这一轮的事件才刚落库，导演栏的锚点要指得准。
  const { reload: reloadLineage } = lineage;
  useEffect(() => {
    if (view === "stage" && !panelReady) return;
    const timer = setInterval(reloadLineage, 2500);
    return () => clearInterval(timer);
  }, [view, panelReady, reloadLineage]);

  // 轮是谱系行级日志上的区间，跟舞台行用同一个 seq 对尺：当前显示行反查回它的轮与台词节点，
  // 四原语就有着落点——不用跳到别的视图去找「刚才那一句」。
  const targets: DirectorTargets = useMemo(() => {
    const line = playback.view;
    if (!lineage.view) return { beatId: null, lineNodeId: null, lineText: line?.text ?? "" };
    return {
      beatId: beatAtLine(cards, line)?.id ?? null,
      lineNodeId: editableNodeAtLine(lineage.view, line)?.id ?? null,
      lineText: line?.text ?? "",
    };
  }, [cards, lineage.view, playback.view]);

  /** 回顾里每条自己落在哪一轮：玩家发来的话没有轮，工具栏上的重来就置灰。 */
  const beatFor = useCallback(
    (entry: TranscriptEntry): string | null =>
      lineage.view ? (beatAtLine(cards, entry)?.id ?? null) : null,
    [cards, lineage.view],
  );

  const hasVoice = useCallback((seq: number | null): boolean => director.hasVoice(seq), [director]);
  const replay = useCallback(
    (seq: number): void => {
      void director.replay(seq);
    },
    [director],
  );

  const toggleVoice = (): void => {
    const next = !voiceOn;
    setVoiceOn(next);
    localStorage.setItem("stage-voice", next ? "1" : "0");
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

  return (
    <div className="screen stage-screen">
      {view === "stage" ? (
        index ? (
          <StageTheater
            visual={playback.visual}
            playback={playback}
            live={stage.state === "streaming"}
            names={stage.names}
            index={index}
            voiceAvailable={stage.voiceAvailable}
            busy={busy}
            chrome={chrome}
            targets={targets}
            onView={setView}
            onPrompt={stage.sendPrompt}
            onFork={fork}
            onEdit={edit}
            onReplay={replay}
            hasVoice={hasVoice}
            onUnlock={unlockVoice}
            onChrome={setChrome}
            onTurbo={setTurbo}
            canContinue={canContinue}
            onContinue={continueBeat}
            overlay={
              panelReady ? (
                <StopPanel
                  stop={stage.stop}
                  isNoStop={stage.isNoStop}
                  disabled={busy}
                  seenChoices={seenChoices}
                  onChoice={stage.sendChoice}
                  onFree={stage.sendFree}
                  onContinue={stage.sendContinue}
                  onPolish={(text) => api.polish(playId, text).then(({ text: polished }) => polished)}
                />
              ) : null
            }
          />
        ) : (
          <div className="overlay">正在连接舞台…</div>
        )
      ) : view === "backlog" ? (
        <BacklogView
          playId={playId}
          entries={playback.history}
          names={stage.names}
          headKey={playback.current?.key ?? null}
          busy={busy}
          voiceAvailable={stage.voiceAvailable}
          hasVoice={hasVoice}
          beatFor={beatFor}
          onSeek={(key) => {
            playback.seek(key);
            setView("stage");
          }}
          onReplay={replay}
          onEdit={edit}
          onFork={fork}
          onClose={() => setView("stage")}
        />
      ) : (
        <RouteTree
          view={lineage.view}
          error={lineage.error}
          names={stage.names}
          busy={busy}
          onReload={lineage.reload}
          onBack={() => setView("stage")}
          ops={ops}
          index={index}
          lines={stage.lines}
        />
      )}

      {/* 顶栏浮在三个视图之上：不在视图里，而是这个剧目的常驻 HUD */}
      <GameBar
        view={view}
        voiceOn={voiceOn}
        workshopOpen={workshop !== null}
        saveName={saveName}
        onView={setView}
        onToggleVoice={toggleVoice}
        onWorkshop={() => setWorkshop((cur) => (cur ? null : "drawer"))}
        onSaves={() => navigate(`/play/${playId}/saves`)}
        onExit={() => navigate(`/play/${playId}`)}
        hidden={!chrome}
      />

      {/* 提示一律走浮层 toast，不占舞台顶部的固定一条 */}
      <ToastStack toasts={toast.toasts} onDismiss={toast.dismiss} />

      {/* 待注入队列：右上角独立面板，空则不占地方。排队中的话能改也能撤 */}
      {view === "stage" && !workshop && (
        <PromptQueuePanel
          items={stage.queue}
          onEdit={(id, text) => stage.sendPromptEdit(id, text)}
          onDelete={(id) => stage.sendPromptDelete(id)}
        />
      )}

      {view === "stage" && workshop && (
        <WorkshopPanel
          playId={playId}
          mode={workshop}
          onModeChange={setWorkshop}
          onClose={() => setWorkshop(null)}
          subscribe={subscribeWorkshop}
          send={stage.send}
          connected={stage.connected}
        />
      )}
    </div>
  );
}
