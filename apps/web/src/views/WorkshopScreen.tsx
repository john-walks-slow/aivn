import { navigate } from "../router.jsx";
import { Icon } from "../ui/Icon.js";
import { WorkshopPanel } from "../workshop/WorkshopPanel.js";
import { useWorkshopSocket } from "../workshop/useWorkshopSocket.js";

/** 全屏工坊页（Title Screen「工坊」直达）：独立连接，不触发演出。 */
export function WorkshopScreen({ playId }: { playId: string }) {
  const socket = useWorkshopSocket(playId);

  return (
    <div className="screen workshop-screen">
      <header className="screen-bar">
        <button className="ghost-btn" onClick={() => navigate(`/play/${playId}`)}>
          <span className="btn-icon">
            <Icon name="back" /> 标题
          </span>
        </button>
        <span className="muted small">{socket.connected ? "工坊已连接" : "连接中…"}</span>
      </header>
      {socket.error && (
        <div className="error-banner" role="alert">
          {socket.error}
        </div>
      )}
      <WorkshopPanel
        playId={playId}
        mode="full"
        onClose={() => navigate(`/play/${playId}`)}
        subscribe={socket.subscribe}
        send={socket.send}
        connected={socket.connected}
      />
    </div>
  );
}
