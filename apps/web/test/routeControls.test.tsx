// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BeatCard } from "../src/stage/beats.js";
import type { LineageOps } from "../src/stage/LineagePanel.js";
import { RouteCanvas, type RouteControls } from "../src/stage/RouteCanvas.js";

function card(id: string, parentId: string | null, turn: number): BeatCard {
  return {
    id,
    turn,
    nodes: [],
    preview: id,
    speakers: [],
    at: turn,
    sceneBg: null,
    cgId: null,
    stopType: null,
    startSeq: turn,
    onPath: true,
    isLeaf: true,
    isAbandoned: false,
    depth: 0,
    parentId,
    forkedFrom: null,
  };
}

const ops: LineageOps = { jump: () => {}, fork: () => {} };

// jsdom 没有 ResizeObserver；画布靠它跟着视口重新取景，这里给一个永不回调的空壳。
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

/**
 * 外层照 StageScreen 的写法接手柄，但只记账不 setState。
 *
 * StageScreen 是把拿到的对象直接存进 state 的（`setRouteControlsStable`）。手柄每换一次
 * 身份就多推一圈渲染，而渲染又换一次身份——浏览器里表现为 `Maximum update depth
 * exceeded`。这里不重现那个滚雪球（否则测试直接挂死），只测滚雪球的第一推动力：
 * 什么都没变时，effect 该不该再交一次手柄。
 */
function Host({ cards, onHandoff }: { cards: BeatCard[]; onHandoff: (c: RouteControls) => void }) {
  return (
    <RouteCanvas cards={cards} ops={ops} busy={false} names={{}} index={null} onControls={onHandoff} />
  );
}

describe("路线画布交给外层的镜头手柄", () => {
  it("卡片没变时反复渲染，只交一次手柄", () => {
    // 布局若在渲染体里重排，placed 每次都是新数组，focusCard / jumpToLatest / controls
    // 跟着换身份，effect 每渲染一次就重跑一次——外层 setState 于是没完没了。
    const cards = [card("a", null, 0)];
    let handoffs = 0;
    // onControls 要稳定，否则每次渲染换身份都会重跑 effect（StageScreen 用 useCallback 固定它）。
    const onHandoff = (): void => void handoffs++;
    const { rerender } = render(<Host cards={cards} onHandoff={onHandoff} />);
    rerender(<Host cards={cards} onHandoff={onHandoff} />);
    rerender(<Host cards={cards} onHandoff={onHandoff} />);
    expect(handoffs).toBe(1);
  });

  it("卡片真的变了才再交一次", () => {
    let handoffs = 0;
    const onHandoff = (): void => void handoffs++;
    const first = [card("a", null, 0)];
    const { rerender } = render(<Host cards={first} onHandoff={onHandoff} />);
    expect(handoffs).toBe(1);
    rerender(<Host cards={[...first, card("b", "a", 1)]} onHandoff={onHandoff} />);
    expect(handoffs).toBe(2);
  });
});
