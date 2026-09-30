import { WorkshopPanel } from "./WorkshopPanel.js";
import {
  closeWorkshop,
  setWorkshopMode,
  type WorkshopMode,
  type WorkshopTab,
} from "./useWorkshopOverlay.js";
import { useWorkshopSocket } from "./useWorkshopSocket.js";

/**
 * 工坊浮层宿主（App 级，挂在所有页面之上）：全站唯一一处建工坊 WS 连接的地方。
 * `?workshop=1` 跳过 autostart——逛工坊不会把演出顺手开起来。
 */
export function WorkshopOverlay({
  playId,
  mode,
  tab,
}: {
  playId: string;
  mode: WorkshopMode;
  tab: WorkshopTab;
}) {
  const socket = useWorkshopSocket(playId);

  return (
    <>
      {/* 抽屉是模态的：点面板外收起，背后页面不接受点击 */}
      {mode === "drawer" && <div className="workshop-scrim" onClick={closeWorkshop} />}
      <WorkshopPanel
        playId={playId}
        mode={mode}
        initialTab={tab}
        onModeChange={setWorkshopMode}
        onClose={closeWorkshop}
        subscribe={socket.subscribe}
        send={socket.send}
        connected={socket.connected}
        socketError={socket.error}
      />
    </>
  );
}
