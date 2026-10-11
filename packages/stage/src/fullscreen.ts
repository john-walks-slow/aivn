import { useCallback, useEffect, useState } from "react";

/**
 * 全屏（沉浸）开关。
 *
 * 手机浏览器上「全屏」不是锦上添花：不进全屏，地址栏与状态栏吃掉一块高度，
 * 画面还压不到摄像头挖孔底下——舞台本来就要铺满整块玻璃。桌面壳（Tauri）
 * 本来就是全屏，浏览器没有全屏能力时返回 null，调用处据此不渲染那枚按钮。
 *
 * 能力差异（`canFullscreen` 就是照着这张表判的，判到「没有」= 不渲染按钮）：
 * - Android Chrome / Edge、桌面 Chrome·Edge·Firefox：`requestFullscreen` 齐全。
 * - 旧 WebKit 与 iOS Safari：只有 `webkitRequestFullscreen`（iPhone 的 Safari
 *   网页上连这个也没有——iPhone 只给 `<video>` 开全屏，PWA standalone 与 iPad
 *   才轮到元素全屏。判到没有就不摆按钮，这是预期行为，不是缺功能）。
 * - Tauri（Windows WebView2）：内核是 Chromium，与桌面 Chrome 同档。
 *
 * 全屏元素取 `document.documentElement`（整棵文档），不是舞台那一块：只把
 * `<div class="stage-screen">` 拉进全屏，切到工坊、回顾时全屏会跟着掉，而且
 * `<html>` 进全屏后 `:fullscreen` 命中根、整页的安全区照样由 env() 给。
 */

/** 带历史前缀的全屏方法（旧 WebKit / iOS Safari）。 */
interface PrefixedFullscreenTarget {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

interface PrefixedFullscreenDocument {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

/** 当前全屏的元素（标准属性与历史前缀各认一遍）。 */
function fullscreenElement(): Element | null {
  const doc = document as Document & PrefixedFullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/** 这一份 document 有没有全屏能力：没有就不该摆一枚按不动的按钮。 */
function canFullscreen(doc: Document): boolean {
  const prefixed = doc as Document & PrefixedFullscreenDocument;
  const root = doc.documentElement as Element & PrefixedFullscreenTarget;
  return (
    typeof root.requestFullscreen === "function" ||
    typeof root.webkitRequestFullscreen === "function" ||
    typeof prefixed.webkitExitFullscreen === "function"
  );
}

export interface FullscreenToggle {
  /** 现在是不是全屏。 */
  on: boolean;
  /**
   * 进出全屏；浏览器没有全屏能力（或不支持时）返回 null，
   * 调用处据此整枚按钮不渲染——摆一枚按不动的按钮只是骗人。
   */
  toggle: (() => void) | null;
}

/** 全屏请求被浏览器拒了（权限策略、iframe 没给 allow="fullscreen"、手势不成立）。 */
export const FULLSCREEN_REJECTED = "全屏没进来，浏览器拒绝了这次请求。";

/**
 * @param onRejected 全屏请求被拒时叫一声（给人一句话的出口）。缺省只落一条 console.warn。
 */
export function useFullscreen(onRejected?: (text: string) => void): FullscreenToggle {
  const supported = typeof document !== "undefined" && canFullscreen(document);
  const [on, setOn] = useState(() => supported && fullscreenElement() !== null);

  useEffect(() => {
    if (!supported) return;
    const sync = (): void => setOn(fullscreenElement() !== null);
    sync();
    // 厂商前缀事件只由老浏览器派发；标准名一律监听，老浏览器多挂一个也不会有副作用。
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, [supported]);

  const toggle = useCallback((): void => {
    void (async () => {
      const doc = document as Document & PrefixedFullscreenDocument;
      const root = document.documentElement as Element & PrefixedFullscreenTarget;
      try {
        if (fullscreenElement() !== null) {
          if (typeof doc.exitFullscreen === "function") await doc.exitFullscreen();
          else doc.webkitExitFullscreen?.();
          return;
        }
        if (typeof root.requestFullscreen === "function") await root.requestFullscreen();
        else root.webkitRequestFullscreen?.();
      } catch {
        // 被拒（iframe 缺 allow="fullscreen"、权限策略、手势不成立）只留一句人话，
        // 不让它变成一条未捕获的 rejection；全屏本来就没成功，状态也不用回滚。
        console.warn(FULLSCREEN_REJECTED);
        onRejected?.(FULLSCREEN_REJECTED);
      }
    })();
  }, [onRejected]);

  return { on, toggle: supported ? toggle : null };
}
