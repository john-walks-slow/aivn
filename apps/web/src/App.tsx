import { useEffect } from "react";
import { useRoute } from "./router.jsx";
import { applyPlayTheme, reloadPlayTheme, THEME_CHANGED } from "./theme.js";
import { LibraryView } from "./views/LibraryView.js";
import { TitleView } from "./views/TitleView.js";
import { StageScreen } from "./views/StageScreen.js";
import { SavesView } from "./views/SavesView.js";
import { SettingsScreen } from "./views/SettingsScreen.js";
import { WorkshopOverlay } from "./workshop/WorkshopOverlay.js";
import { closeWorkshop, useWorkshopOverlay } from "./workshop/useWorkshopOverlay.js";

/** hash 路由：#/ 剧目库 · #/settings 设置 · #/play/:id Title · #/play/:id/stage 舞台 · #/play/:id/saves 周目。 */
export function App() {
  const route = useRoute();
  const [head, playId, sub] = route.segments;
  const workshop = useWorkshopOverlay();

  // 剧目主题：进出剧目挂载/摘除，切剧目时重挂一张表。
  useEffect(() => {
    applyPlayTheme(head === "play" ? (playId ?? null) : null);
  }, [head, playId]);

  // 工坊存盘后重取 theme.css，换皮即时可见。
  useEffect(() => {
    const onReload = (): void => reloadPlayTheme();
    window.addEventListener(THEME_CHANGED, onReload);
    return () => window.removeEventListener(THEME_CHANGED, onReload);
  }, []);

  // 工坊是浮层不是页面——没有自己的路由，换页就收起（浏览器后退也走这条路）
  useEffect(() => {
    closeWorkshop();
  }, [route.path]);

  const screen = (() => {
    if (head === "settings") return <SettingsScreen />;
    if (head === "play" && playId && sub === "stage") return <StageScreen playId={playId} />;
    if (head === "play" && playId && sub === "saves") return <SavesView playId={playId} />;
    if (head === "play" && playId) return <TitleView playId={playId} />;
    return <LibraryView />;
  })();

  return (
    <>
      {screen}
      {workshop && (
        <WorkshopOverlay
          key={workshop.playId}
          playId={workshop.playId}
          mode={workshop.mode}
          tab={workshop.tab}
        />
      )}
    </>
  );
}
