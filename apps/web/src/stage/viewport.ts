import { useEffect } from "react";

/**
 * 软键盘顶起（P6 手机适配）：iOS Safari 的 100dvh 不随键盘收缩，
 * 键盘弹出时可视区高度会变窄——把差值写进 `--kb` 让舞台与面板缩到可视区内，
 * 否则自由输入框会被键盘盖住、选项点不到。
 */
export function useVisualViewport(): void {  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = (): void => {
      const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--kb", `${Math.round(gap)}px`);
    };
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    sync();
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      document.documentElement.style.removeProperty("--kb");
    };
  }, []);
}
