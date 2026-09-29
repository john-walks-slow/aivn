import { Icon } from "../ui/Icon.js";
import type { IconName } from "../ui/Icon.js";
import type { StageView } from "./StageTheater.js";

/**
 * 顶栏：游戏 HUD 而非网页工具栏。
 * 舞台本身就是当前视图，所以没有「舞台」这个标签——只留离开/翻记录/看路线/开工坊四个去处，
 * 外加一个静音（语音开关是全局的，不该混在某个视图里）。
 * 三个去处都开全屏浮层（浮层自带关闭键并盖住本栏），所以这里没有「再点一次收起」。
 */
export interface GameBarProps {
  view: StageView;
  voiceOn: boolean;
  workshopOpen: boolean;
  saveName: string | null;
  onView: (view: StageView) => void;
  onToggleVoice: () => void;
  onWorkshop: () => void;
  onSaves: () => void;
  onExit: () => void;
  hidden?: boolean;
}

const NAV: { id: Exclude<StageView, "stage">; label: string; title: string; icon: IconName }[] = [
  { id: "backlog", label: "LOG", title: "回顾：这一场说过的话", icon: "menu" },
  { id: "route", label: "BRANCH", title: "路线：岔出去的世界线", icon: "fork" },
];

export function GameBar({
  view,
  voiceOn,
  workshopOpen,
  saveName,
  onView,
  onToggleVoice,
  onWorkshop,
  onSaves,
  onExit,
  hidden,
}: GameBarProps) {
  if (hidden) return null;
  return (
    <nav className="gui-bar" aria-label="主菜单">
      <div className="gui-bar-group">
        <button type="button" className="gui-btn" onClick={onExit} title="离开舞台，回到剧目">
          <Icon name="exit" size={17} />
          <span className="gui-label">EXIT</span>
        </button>
        <span className="gui-sep" aria-hidden />
        {NAV.map(({ id, label, title, icon }) => (
          <button
            key={id}
            type="button"
            className={`gui-btn ${view === id ? "on" : ""}`.trim()}
            onClick={() => onView(id)}
            title={title}
            aria-pressed={view === id}
          >
            <Icon name={icon} size={17} />
            <span className="gui-label">{label}</span>
          </button>
        ))}
        <button
          type="button"
          className="gui-btn"
          onClick={onToggleVoice}
          title={voiceOn ? "静音" : "开声"}
          aria-pressed={voiceOn}
        >
          <Icon name={voiceOn ? "volume" : "mute"} size={17} />
          <span className="gui-label">{voiceOn ? "SOUND" : "MUTE"}</span>
        </button>
        <span className="gui-sep" aria-hidden />
        {saveName && (
          <button
            type="button"
            className="gui-btn gui-save"
            onClick={onSaves}
            title={`当前周目：${saveName}（点此切换）`}
          >
            <span className="gui-save-label">{saveName}</span>
          </button>
        )}
        <button
          type="button"
          className={`gui-btn ${workshopOpen ? "on" : ""}`.trim()}
          onClick={onWorkshop}
          title="工坊：改设定与剧目文件"
          aria-pressed={workshopOpen}
        >
          <Icon name="workshop" size={17} />
          <span className="gui-label">STUDIO</span>
        </button>
      </div>
    </nav>
  );
}
