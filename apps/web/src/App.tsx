import { useRoute } from "./router.jsx";
import { LibraryView } from "./views/LibraryView.js";
import { TitleView } from "./views/TitleView.js";
import { StageScreen } from "./views/StageScreen.js";
import { AssetsView } from "./views/AssetsView.js";

/** hash 路由：#/ 剧目库 · #/play/:id Title · #/play/:id/stage 舞台 · #/play/:id/assets 素材与配置。 */
export function App() {
  const route = useRoute();
  const [head, playId, sub] = route.segments;

  if (head === "play" && playId && sub === "stage") {
    return <StageScreen playId={playId} mode={route.query.get("mode") === "start" ? "start" : "continue"} />;
  }
  if (head === "play" && playId && sub === "assets") {
    return <AssetsView playId={playId} />;
  }
  if (head === "play" && playId) {
    return <TitleView playId={playId} />;
  }
  return <LibraryView />;
}
