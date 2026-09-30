import { useSyncExternalStore } from "react";

/** 抽屉：从右侧滑入压在页面上；全屏：就地铺满视口。两者是同一个浮层的两种形态。 */
export type WorkshopMode = "drawer" | "full";

/** 工坊四个 tab：对话 / 素材 / 配置（创作口径）/ 文件。 */
export type WorkshopTab = "chat" | "assets" | "craft" | "files";

export interface WorkshopOverlayState {
  playId: string;
  mode: WorkshopMode;
  tab: WorkshopTab;
}

/**
 * 工坊浮层的开合状态。放在模块级而不是某个页面里，是因为工坊不属于任何一页——
 * 舞台的 STUDIO 键和 Title 的「工坊」按钮打开的是同一个浮层，全站只有一份。
 */
let state: WorkshopOverlayState | null = null;
const listeners = new Set<() => void>();

function emit(next: WorkshopOverlayState | null): void {
  state = next;
  for (const listener of listeners) listener();
}

/** `tab` 只在开的时候定一次（点 Title 的「素材与配置」要直接落在素材页）。 */
export function openWorkshop(
  playId: string,
  options: { mode?: WorkshopMode; tab?: WorkshopTab } = {},
): void {
  emit({ playId, mode: options.mode ?? "drawer", tab: options.tab ?? "chat" });
}

export function closeWorkshop(): void {
  if (state) emit(null);
}

export function setWorkshopMode(mode: WorkshopMode): void {
  if (state) emit({ ...state, mode });
}

/** 舞台 STUDIO 键的开关语义：同一剧目再点一次收起。 */
export function toggleWorkshop(playId: string): void {
  if (state?.playId === playId) closeWorkshop();
  else openWorkshop(playId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): WorkshopOverlayState | null => state;

export function useWorkshopOverlay(): WorkshopOverlayState | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}
