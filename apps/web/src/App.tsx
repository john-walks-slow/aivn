import { useEffect } from "react";
import { useRoute } from "./router.jsx";
import { applyPlayTheme, reloadPlayTheme, THEME_CHANGED } from "./theme.js";
import { LibraryView } from "./views/LibraryView.js";
import { TitleView } from "./views/TitleView.js";
import { StageScreen } from "./views/StageScreen.js";
import { SavesView } from "./views/SavesView.js";
import { SettingsScreen } from "./views/SettingsScreen.js";

/**
 * hash 路由：#/ 剧目库 · #/settings 设置 · #/play/:id Title · #/play/:id/stage 舞台
 * （带 ?view=workshop[&tab=…][&workshop=1] 直达工坊）· #/play/:id/saves 周目。
 *
 * 工坊没有独立路由：它是舞台外壳的第四个视图。少一个路由就少一套顶栏——
 * 从标题页进工坊时页头整个换掉，正是这套外壳要收拾的毛病。
 */
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
    // key = query：工坊入口与「回舞台」都靠改 query 换一条连接（workshop=1 → 真舞台连接），
    // 而 hash 变化不会重新挂载同一个路由的组件——不拿 query 当 key，重挂就是空操作，
    // 舞台会一片空白（连接还是工坊那条，不会 autostart）。
    return <StageScreen key={route.query.toString()} playId={playId} search={route.query.toString()} />;
  }
  if (head === "play" && playId && sub === "saves") {
    return <SavesView playId={playId} />;
  }
  if (head === "play" && playId) {
    return <TitleView playId={playId} />;
  }
  return <LibraryView />;
}
