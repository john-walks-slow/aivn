import { useEffect, useState } from "react";

/**
 * 媒体查询当前是否命中（例：`useMediaQuery("(max-width: 900px)")`）。
 *
 * 只给「宽窄两态下**交互本身不同**」的地方用——纯样式差异一律走 CSS，
 * 不要为了改个尺寸把断点抄进 JS（两处断点会漂）。
 * 目前唯一的用处是设置页分组的折叠开关：桌面没有可收的东西，
 * 那枚按钮就不该存在（不是「存在但按不动」——键盘仍会停在它上面）。
 *
 * 环境没有 matchMedia（jsdom）时恒按宽屏算：样式本来也只由 CSS 决定，
 * 少一层交互不影响正确性。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const sync = (): void => setMatches(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);

  return matches;
}
