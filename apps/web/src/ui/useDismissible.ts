import { useState } from "react";

/**
 * 「这条通知能不能收起来」。
 *
 * 收起只影响显示，不碰产生它的状态——错误本身没被抹掉，只是人不看了；
 * 值一变（新的错、新的回执）就重新露出来，不该让一次收起把后面所有通知都吞掉。
 */
export function useDismissible<T>(value: T): { hidden: boolean; dismiss: () => void } {
  const [hidden, setHidden] = useState<T | null>(null);
  return {
    hidden: value !== null && hidden === value,
    dismiss: () => setHidden(value),
  };
}
