import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type PlayDetail } from "../api.js";
import { navigate } from "../router.jsx";
import { useStageSocket, type WorkshopInbound } from "../stage/useStageSocket.js";
import { usePlayback } from "../stage/director.js";
import { VoiceDirector } from "../stage/audio.js";
import { buildAssetIndex, type AssetIndex } from "../stage/assets.js";
import { useGeneratedAssets } from "../stage/generatedAssets.js";
import { StageTheater } from "../stage/StageTheater.js";
import { BranchScript, RouteTree, useLineage, type LineageOps } from "../stage/LineagePanel.js";
import { StopPanel } from "../stage/StopPanel.js";
import { useVisualViewport } from "../stage/viewport.js";
import { WorkshopPanel, type WorkshopMode } from "../workshop/WorkshopPanel.js";

/** 演出屏：舞台（视觉层+打字机+语音）/ 剧本 log 双视图 + 停止点面板。 */
export function StageScreen({ playId }: { playId: string }) {
  const directorRef = useRef<VoiceDirector | null>(null);
  if (!directorRef.current) directorRef.current = new VoiceDirector();
  const director = directorRef.current;
  const [, setAudioTick] = useState(0); // 语音状态变化（hold 解除/解锁）触发重渲染
  const [voiceOn, setVoiceOn] = useState(() => localStorage.getItem("stage-voice") !== "0");
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [assets, setAssets] = useState<Record<string, string[]>>({});
  const [view, setView] = useState<"stage" | "log" | "route">("stage");
  /** P6 缓冲换代：token 变化 = 事件缓冲被整段重放；resume 决定快进还是继续流式。 */
  const [rebase, setRebase] = useState({ token: 0, resume: true });
  /** 导演视图的数据代次：每次操作后自增，把谱系拉回来。 */
  const [lineageNonce, setLineageNonce] = useState(0);
  const [oocQueued, setOocQueued] = useState(false);
  const [workshop, setWorkshop] = useState<WorkshopMode | null>(null);
  const [imageWarn, setImageWarn] = useState<string | null>(null);
  useVisualViewport();
  const generated = useGeneratedAssets();
  // 生图回调要在 socket 建连时就能摸到 playback，但 playback 声明在后面
  const playbackRef = useRef<ReturnType<typeof usePlayback> | null>(null);
  // 谱系只在这两个导演视图里拉取（打开/操作后/手动刷新），不做每拍广播
  const lineage = useLineage(playId, lineageNonce);
  // 工坊下行消息的订阅表：面板挂载时登记，卸载时注销（与舞台状态机解耦）
  const workshopHandlers = useRef(new Set<(msg: WorkshopInbound) => void>());
  const subscribeWorkshop = useCallback((handler: (msg: WorkshopInbound) => void) => {
    workshopHandlers.current.add(handler);
    return () => {
      workshopHandlers.current.delete(handler);
    };
  }, []);

  const stage = useStageSocket(playId, {
    onAudio: (ready) => director.handleAudio(ready),
    onBeatStart: () => {
      director.beatStarted();
      setOocQueued(false); // 新拍已吃到导演注
      setLineageNonce((n) => n + 1); // 上一拍的玩家表态进谱系了，选肢的「已选过」要跟上
    },
    onReset: () => director.reset(),
    onOocAck: () => setOocQueued(true),
    // P6 上下文重建：新分支整段到达——播放层复位，谱系视图跟着换
    onRebase: ({ note, busy: streaming }) => {
      director.reset();
      setRebase((cur) => ({ token: cur.token + 1, resume: !streaming }));
      setLineageNonce((n) => n + 1);
      if (note) setImageWarn(note);
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
      setImageWarn(`生图失败：${message}`);
    },
    onWorkshop: (msg) => {
      for (const handler of workshopHandlers.current) handler(msg);
    },
  });

  // 渲染期回调绑定（N6：置于 stage 声明后，闭包引用才不踩未初始化的 TDZ）
  director.onNotify = () => setAudioTick((t) => t + 1);
  director.onControl = (state) => stage.sendTtsControl(state);

  // 导演出口（P6）：senders 在 useStageSocket 内 useCallback 稳定，仅重连后换引用
  const {
    sendFork: fork,
    sendEdit: editLine,
    sendRewrite: rewrite,
    sendOocAt: oocAt,
  } = stage;
  const ops: LineageOps = useMemo(
    () => ({ fork, edit: editLine, rewrite, oocAt }),
    [fork, editLine, rewrite, oocAt],
  );


  // 走过的岔路口：玩家在这条线之外已经说过的选项，卡片上打「✓ 已选过」提醒存在多条命运
  const seenChoices = useMemo(
    () =>
      new Set((lineage.view?.nodes ?? []).filter((n) => n.kind === "player" && n.text).map((n) => n.text)),
    [lineage.view],
  );

  useEffect(() => {
    api.playDetail(playId).then(setDetail).catch(() => {});
    api.listAssets(playId).then(setAssets).catch(() => {});
    return () => director.dispose();
  }, [playId]);

  // 语音开关本地态 ↔ 服务端（连接建立/重连/切换时同步；关=停合成省配额）
  useEffect(() => {
    if (!stage.voiceAvailable) return;
    director.setEnabled(voiceOn);
    stage.sendTtsControl({ enabled: voiceOn });
  }, [stage.voiceAvailable, stage.state, voiceOn]);

  // 导演视图开着时定期拉谱系：一拍的事件是流式落库的，不刷新会看到一棵冻住的树
  const { reload: reloadLineage } = lineage;
  useEffect(() => {
    if (view === "stage") return;
    const timer = setInterval(reloadLineage, 2500);
    return () => clearInterval(timer);
  }, [view, reloadLineage]);

  const index: AssetIndex | null = useMemo(
    () => (detail ? buildAssetIndex(playId, detail.play, assets, generated.images) : null),
    [detail, assets, playId, generated.images],
  );

  const playback = usePlayback(stage.cues, stage.lines, {
    live: stage.state === "streaming",
    resume: true,
    revision: stage.revision,
    // P6：缓冲被结构性操作整段重放 → 播放层强制归零（换代后快进到新分支末尾）
    resetToken: rebase.token,
    resumeAfterReset: rebase.resume,
    // D5 文字先行 + 语音收尾：自动模式等当前句语音播完再推进
    hold: director.holdsLine(),
    onLineStart: (line) => director.lineStarted(line?.seq, line?.type === "say"),
    onFastForward: () => director.fastForward(),
  });
  playbackRef.current = playback;
  // 拍收束后还要等编排器真正空闲（beat_settled），否则玩家点选项会被「演出进行中」挡回
  const busy = stage.state === "streaming" || stage.state === "connecting" || !stage.settled;
  // D4：先演完再交互——打字机未消费完前不露出停止点（防剧透/防提前发送）
  const lineDone = playback.current === null || playback.shownLength >= playback.current.text.length;
  const panelReady = !busy && playback.exhausted && lineDone;

  const toggleVoice = (): void => {
    const next = !voiceOn;
    setVoiceOn(next);
    localStorage.setItem("stage-voice", next ? "1" : "0");
  };

  const unlockVoice = (): void => {
    director.unlock();
    setAudioTick((t) => t + 1);
  };

  return (
    <div className="screen stage-screen">
      {stage.error && (
        <div className="error-banner" role="alert">
          {stage.error}
        </div>
      )}
      {imageWarn && (
        <div className="warn-banner" role="status" onClick={() => setImageWarn(null)}>
          {imageWarn}
        </div>
      )}

      {view === "stage" ? (
        index ? (
          <StageTheater
            visual={playback.visual}
            playback={playback}
            live={stage.state === "streaming"}
            names={stage.names}
            index={index}
            voiceAvailable={stage.voiceAvailable}
            voiceOn={voiceOn}
            unlocked={director.unlocked}
            oocQueued={oocQueued}
            onOoc={stage.sendOoc}
            onToggleVoice={toggleVoice}
            onUnlock={unlockVoice}
            onBack={() => navigate(`/play/${playId}`)}
            onLog={() => setView("log")}
            onRoute={() => setView("route")}
            onWorkshop={() => setWorkshop("drawer")}
            saveName={stage.saveName}
            onSaves={() => navigate(`/play/${playId}/saves`)}
            overlay={
              panelReady ? (
                <StopPanel
                  stop={stage.stop}
                  isActEnd={stage.isActEnd}
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
      ) : view === "route" ? (
        <RouteTree
          view={lineage.view}
          error={lineage.error}
          names={stage.names}
          busy={busy}
          onReload={lineage.reload}
          onBack={() => setView("stage")}
          ops={ops}
          index={index}
        />
      ) : (
        <BranchScript
          view={lineage.view}
          error={lineage.error}
          names={stage.names}
          busy={busy}
          onReload={lineage.reload}
          onBack={() => setView("stage")}
          ops={ops}
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
        />
      )}

    </div>
  );
}
