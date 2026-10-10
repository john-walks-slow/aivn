import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Modal } from "@aivn/stage";

/**
 * 「这一页有没保存的改动」的登记处。
 *
 * 各页自己知道改没改（草稿与盘上那份比出来），但切页的人在上层——工坊壳要拦的是
 * 「切 tab / 回舞台 / 退出工坊」这几个动作，而它看不到下层的草稿。于是让页把状态登记上来，
 * 由一个 context 汇总。不登记就当作没有改动，绝不拦人。
 */
interface DirtyRegistry {
  set: (key: string, dirty: boolean) => void;
  anyDirty: boolean;
  /** 有未保存改动时先问一句再执行；没有改动就直接执行。 */
  requestLeave: (action: () => void) => void;
}

const DirtyContext = createContext<DirtyRegistry | null>(null);

export function DirtyGuardProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  /** 被拦下来的那个动作：确认「不保存」之后才执行它。 */
  const [pending, setPending] = useState<(() => void) | null>(null);

  const set = useCallback((key: string, dirty: boolean): void => {
    setFlags((prev) =>
      prev[key] === dirty ? prev : { ...prev, [key]: dirty },
    );
  }, []);

  const anyDirty = Object.values(flags).some(Boolean);

  const requestLeave = useCallback(
    (action: () => void): void => {
      if (anyDirty) setPending(() => action);
      else action();
    },
    [anyDirty],
  );

  // 换一个剧目时把登记清掉：不该带着上一个剧目的「未保存」
  useEffect(() => {
    return () => setFlags({});
  }, []);

  const value = useMemo<DirtyRegistry>(
    () => ({ set, anyDirty, requestLeave }),
    [set, anyDirty, requestLeave],
  );

  return (
    <DirtyContext.Provider value={value}>
      {children}
      {pending && (
        <Modal
          title="这一页还有没保存的改动"
          kicker={null}
          hint="切走就没了——草稿只在这个页面里。要保存就先取消、按那页的「保存」。"
          onClose={() => setPending(null)}
          footer={
            <>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  const action = pending;
                  setPending(null);
                  action();
                }}
              >
                不保存，直接走
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => setPending(null)}
              >
                留在这页
              </button>
            </>
          }
        >
          <p className="muted small">
            工坊只把改动写进剧目文件；没按保存的输入不进任何文件。
          </p>
        </Modal>
      )}
    </DirtyContext.Provider>
  );
}

/** 读汇总状态与「问一句再走」（工坊壳与 Esc 用）。没有 Provider 时恒为「没有改动」。 */
export function useAnyDirty(): boolean {
  return useContext(DirtyContext)?.anyDirty ?? false;
}

/** 拿 requestLeave：舞台外壳的 Esc、工坊的切页都从这一处拦。 */
export function useLeaveGuard(): (action: () => void) => void {
  const ctx = useContext(DirtyContext);
  return ctx?.requestLeave ?? ((action: () => void) => action());
}

/** 页里登记自己的改动状态：`useDirtyFlag("play", dirty)`。 */
export function useDirtyFlag(key: string, dirty: boolean): void {
  const ctx = useContext(DirtyContext);
  const set = ctx?.set;
  useEffect(() => {
    if (!set) return;
    set(key, dirty);
    return () => set(key, false);
  }, [set, key, dirty]);
}
