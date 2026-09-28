import { useEffect, useMemo, useRef, useState } from "react";
import { api, type PlayDetail } from "../api.js";
import { navigate, replace } from "../router.jsx";
import { useStageSocket, type StartMode } from "../stage/useStageSocket.js";
import { usePlayback } from "../stage/director.js";
import { VoiceDirector } from "../stage/audio.js";
import { buildAssetIndex, type AssetIndex } from "../stage/assets.js";
import { StageTheater } from "../stage/StageTheater.js";
import { StageView } from "../stage/StageView.js";
import { StopPanel } from "../stage/StopPanel.js";

/** 演出屏：舞台（视觉层+打字机+语音）/ 剧本 log 双视图 + 停止点面板。 */
export function StageScreen({ playId, mode }: { playId: string; mode: StartMode }) {
  const directorRef = useRef<VoiceDirector | null>(null);
  if (!directorRef.current) directorRef.current = new VoiceDirector();
  const director = directorRef.current;
  const [, setAudioTick] = useState(0); // 语音状态变化（hold 解除/解锁）触发重渲染
  const [voiceOn, setVoiceOn] = useState(() => localStorage.getItem("stage-voice") !== "0");
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [assets, setAssets] = useState<Record<string, string[]>>({});
  const [view, setView] = useState<"stage" | "log">("stage");

  const stage = useStageSocket(playId, mode, {
    onAudio: (ready) => director.handleAudio(ready),
    onBeatStart: () => director.beatStarted(),
    onReset: () => director.reset(),
  });

  // 渲染期回调绑定（N6：置于 stage 声明后，闭包引用才不踩未初始化的 TDZ）
  director.onNotify = () => setAudioTick((t) => t + 1);
  director.onControl = (state) => stage.sendTtsControl(state);

  useEffect(() => {
    // start 只消费一次：地址栏剥掉 ?mode（replace 不留历史），刷新后走 continue 保护进度
    if (location.hash.includes("mode=")) {
      const [path = "/"] = location.hash.slice(1).split("?");
      replace(path);
    }
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

  const index: AssetIndex | null = useMemo(
    () => (detail ? buildAssetIndex(playId, detail.play, assets) : null),
    [detail, assets, playId],
  );

  const playback = usePlayback(stage.cues, stage.lines, {
    live: stage.state === "streaming",
    resume: mode === "continue",
    revision: stage.revision,
    // D5 文字先行 + 语音收尾：自动模式等当前句语音播完再推进
    hold: director.holdsLine(),
    onLineStart: (line) => director.lineStarted(line?.seq, line?.type === "say"),
    onFastForward: () => director.fastForward(),
  });
  const busy = stage.state === "streaming" || stage.state === "connecting";
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
            onToggleVoice={toggleVoice}
            onUnlock={unlockVoice}
            onBack={() => navigate(`/play/${playId}`)}
            onLog={() => setView("log")}
          />
        ) : (
          <div className="overlay">正在连接舞台…</div>
        )
      ) : (
        <>
          <header className="screen-bar">
            <button className="ghost-btn" onClick={() => navigate(`/play/${playId}`)}>
              ← 标题
            </button>
            <span className="muted">剧本 log（只读）</span>
            <button className="ghost-btn" onClick={() => setView("stage")}>
              返回舞台
            </button>
          </header>
          <StageView
            lines={stage.lines}
            names={stage.names}
            streaming={stage.state === "streaming"}
            revision={stage.revision}
          />
        </>
      )}

      {view === "stage" &&
        (panelReady ? (
          <StopPanel
            stop={stage.stop}
            isActEnd={stage.isActEnd}
            disabled={busy}
            onChoice={stage.sendChoice}
            onFree={stage.sendFree}
            onContinue={stage.sendContinue}
            onOoc={stage.sendOoc}
          />
        ) : (
          <footer className="stop-panel">
            <div className="stop-hint">演出进行中…</div>
          </footer>
        ))}
    </div>
  );
}
