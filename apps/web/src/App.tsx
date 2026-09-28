import { useStageSocket } from "./stage/useStageSocket.js";
import { StageView } from "./stage/StageView.js";
import { StopPanel } from "./stage/StopPanel.js";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

/** 状态徽标文案。 */
const STATE_LABEL: Record<string, string> = {
  connecting: "连接中",
  streaming: "演出中",
  stopped: "等待你的回应",
  error: "出错",
};

export function App() {
  const stage = useStageSocket(WS_URL);
  const busy = stage.state === "streaming" || stage.state === "connecting";

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar-title">Stage-AI</span>
        <span className="topbar-scene">{stage.scene || "…"}</span>
        <span className={`topbar-state state-${stage.state}`}>
          {stage.state === "error" ? (stage.error ?? "出错") : STATE_LABEL[stage.state]}
        </span>
      </header>

      {stage.error && (
        <div className="error-banner" role="alert">
          {stage.error}
        </div>
      )}

      {stage.state === "connecting" && <div className="overlay">正在连接舞台…</div>}

      <StageView lines={stage.lines} names={stage.names} streaming={stage.state === "streaming"} revision={stage.revision} />

      <StopPanel
        stop={stage.stop}
        isActEnd={stage.isActEnd}
        disabled={busy}
        onChoice={stage.sendChoice}
        onFree={stage.sendFree}
        onContinue={stage.sendContinue}
        onOoc={stage.sendOoc}
      />
    </div>
  );
}
