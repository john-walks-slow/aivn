import { useEffect } from "react";
import { useRoute } from "./router.jsx";
import { applyPlayTheme, reloadPlayTheme, THEME_CHANGED } from "./theme.js";
import { LibraryView } from "./views/LibraryView.js";
import { TitleView } from "./views/TitleView.js";
import { StageScreen } from "./views/StageScreen.js";
import { SavesView } from "./views/SavesView.js";
import { WorkshopScreen } from "./views/WorkshopScreen.js";
import { SettingsScreen } from "./views/SettingsScreen.js";

/** hash 路由：#/ 剧目库 · #/settings 设置 · #/play/:id Title · #/play/:id/stage 舞台 · #/play/:id/saves 周目 · #/play/:id/workshop 工坊。 */
export function App() {
  const route = useRoute();
  const [head, playId, sub] = route.segments;

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

  if (head === "settings") return <SettingsScreen />;
  if (head === "play" && playId && sub === "stage") {
    return <StageScreen playId={playId} />;
  }
  if (head === "play" && playId && sub === "saves") {
    return <SavesView playId={playId} />;
  }
  if (head === "play" && playId && sub === "workshop") {
    return <WorkshopScreen playId={playId} />;
  }
  if (head === "play" && playId) {
    return <TitleView playId={playId} />;
  }
  return <LibraryView />;
}
