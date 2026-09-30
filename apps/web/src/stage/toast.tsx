import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon.js";

export type ToastKind = "info" | "warn" | "error";

export interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}

/** 普通提示自己退场的时间；错误要等人点掉——它多半是「这一轮演不下去了」，不能一闪而过。 */
const AUTO_DISMISS_MS = 3600;

export interface Toaster {
  toasts: Toast[];
  push: (text: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
}

/**
 * 提示一律走浮层 toast，不占页面顶部的横幅位。
 * 顶部横幅是布局的一部分，提示一顶上去就把舞台往下推——演出里最不该发生的就是画面在抖。
 */
export function useToasts(): Toaster {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number): void => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (text: string, kind: ToastKind = "info"): void => {
      if (!text) return;
      const id = nextId.current;
      nextId.current += 1;
      setToasts((cur) => [...cur.slice(-2), { id, text, kind }]);
      if (kind === "info") {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
        );
      }
    },
    [dismiss],
  );

  const timersRef = timers;
  useEffect(() => {
    const pending = timersRef.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, [timersRef]);

  return { toasts, push, dismiss };
}

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast toast-${toast.kind}`}
          onClick={() => onDismiss(toast.id)}
          title="点掉"
        >
          {toast.kind === "info" ? <Icon name="check" /> : <Icon name="alert" />}
          <span>{toast.text}</span>
        </button>
      ))}
    </div>
  );
}
