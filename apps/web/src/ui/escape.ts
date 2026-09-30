import { useEffect, useRef } from "react";

/**
 * Esc 归属：只让最上层那个浮层响应。
 * 各浮层各自往 window 上挂监听时，Esc 会一路把底下几层一起关掉——灯箱开着按 Esc，
 * 工坊抽屉跟着没了；抽屉开着按 Esc，舞台的导演注也跟着撤了。
 * 挂载顺序即层级顺序（后挂的盖在上面），所以这里只维护一个栈，由栈顶独占 Esc。
 */
const stack: Array<() => void> = [];

function onKeyDown(e: KeyboardEvent): void {
  // 输入法组字中（中文选词按 Esc 是关候选窗，不是关浮层）——否则会连草稿一起丢
  if (e.key !== "Escape" || e.isComposing || e.keyCode === 229) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  top();
}

/** 栈里有人 = 这一下 Esc 已经有人认领，页面底下的键盘处理应当让位。 */
export function escapeClaimed(): boolean {
  return stack.length > 0;
}

/**
 * 把 Esc 关给当前浮层。回调用 ref 存，换引用不会重排栈——
 * 栈顺序必须只由挂载顺序决定，否则后渲染的底层浮层会插到顶层上面。
 */
export function useEscape(onEscape: () => void, enabled = true): void {
  const handler = useRef(onEscape);
  handler.current = onEscape;

  useEffect(() => {
    if (!enabled) return;
    const entry = (): void => handler.current();
    stack.push(entry);
    if (stack.length === 1) window.addEventListener("keydown", onKeyDown);
    return () => {
      const at = stack.indexOf(entry);
      if (at >= 0) stack.splice(at, 1);
      if (stack.length === 0) window.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled]);
}
