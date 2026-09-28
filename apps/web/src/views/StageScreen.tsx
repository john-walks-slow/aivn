import { useEffect, useMemo, useState } from "react";
import { api, type PlayDetail } from "../api.js";
import { navigate, replace } from "../router.jsx";
import { useStageSocket, type StartMode } from "../stage/useStageSocket.js";
import { usePlayback } from "../stage/director.js";
import { buildAssetIndex, type AssetIndex } from "../stage/assets.js";
import { StageTheater } from "../stage/StageTheater.js";
import { StageView } from "../stage/StageView.js";
import { StopPanel } from "../stage/StopPanel.js";

/** 演出屏：舞台（视觉层+打字机）/ 剧本 log 双视图 + 停止点面板。 */
export function StageScreen({ playId, mode }: { playId: string; mode: StartMode }) {
  const stage = useStageSocket(playId, mode);
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [assets, setAssets] = useState<Record<string, string[]>>({});
  const [view, setView] = useState<"stage" | "log">("stage");

  useEffect(() => {
    // start 只消费一次：地址栏剥掉 ?mode（replace 不留历史），刷新后走 continue 保护进度
    if (location.hash.includes("mode=")) {
      const [path = "/"] = location.hash.slice(1).split("?");
      replace(path);
    }
    api.playDetail(playId).then(setDetail).catch(() => {});
    api.listAssets(playId).then(setAssets).catch(() => {});
  }, [playId]);

  const index: AssetIndex | null = useMemo(
    () => (detail ? buildAssetIndex(playId, detail.play, assets) : null),
    [detail, assets, playId],
  );

  const playback = usePlayback(stage.cues, stage.lines, {
    live: stage.state === "streaming",
    resume: mode === "continue",
    revision: stage.revision,
  });
  const busy = stage.state === "streaming" || stage.state === "connecting";
  // D4：先演完再交互——打字机未消费完前不露出停止点（防剧透/防提前发送）
  const lineDone = playback.current === null || playback.shownLength >= playback.current.text.length;
  const panelReady = !busy && playback.exhausted && lineDone;

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
