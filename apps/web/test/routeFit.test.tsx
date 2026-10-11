// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BeatCard } from "../src/stage/beats.js";
import type { LineageOps } from "../src/stage/LineagePanel.js";
import { RouteCanvas } from "../src/stage/RouteCanvas.js";

function card(id: string, parentId: string | null, turn: number): BeatCard {
  return {
    id,
    startNodeId: id,
    endNodeId: id,
    forkFromId: id,
    turn,
    nodes: [],
    preview: id,
    speakers: [],
    at: turn,
    sceneBg: null,
    cgId: null,
    stopType: null,
    startSeq: turn,
    endSeq: turn,
    onPath: true,
    isLeaf: true,
    isAbandoned: false,
    depth: 0,
    parentId,
    forkedFrom: null,
  };
}

/** 一条从 a 起、依次接下去的长链：用来造「收不下」的树。 */
function chain(length: number): BeatCard[] {
  return Array.from({ length }, (_, i) =>
    card(String.fromCharCode(97 + i), i === 0 ? null : String.fromCharCode(96 + i), i),
  );
}

const ops: LineageOps = { jump: () => {}, rewrite: () => {}, remove: () => {} };

/** jsdom 里的元素没有布局尺寸，取景无从算起：整块画布按 1200×800 发。 */
let viewport = { width: 1200, height: 800 };

/**
 * 画布的假 ResizeObserver。
 *
 * 真的那个会在 `observe()` 之后补一次「现在的尺寸」通知，并在每次尺寸变化时再通知；
 * 画布重挂 observer（例如 effect 因布局尺寸换身份而重跑）同样会补一次——那正是
 * 「树一长大镜头就被重置」的来路，所以这里要能数出挂了几次、并手动触发回调。
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  private targets: Element[] = [];

  constructor(private readonly cb: () => void) {
    FakeResizeObserver.instances.push(this);
  }

  observe(el: Element): void {
    this.targets.push(el);
  }

  unobserve(): void {}

  disconnect(): void {
    this.targets = [];
  }

  /** 画布尺寸真的变了（转屏、缩窗口、面板让位）。 */
  trigger(): void {
    if (this.targets.length === 0) throw new Error("observer 已经断了");
    this.cb();
  }
}

beforeEach(() => {
  viewport = { width: 1200, height: 800 };
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  // 取景认的是布局尺寸：clientWidth/Height 就是它。
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => viewport.width);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(() => viewport.height);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function canvas(cards: readonly BeatCard[], onControls: () => void = () => {}) {
  return (
    <RouteCanvas
      cards={cards}
      ops={ops}
      busy={false}
      names={{}}
      index={null}
      onControls={onControls}
    />
  );
}

function cameraOf(container: HTMLElement): string {
  const scene = container.querySelector(".route-scene");
  if (!scene) throw new Error("画布没渲染出来");
  return (scene as HTMLElement).style.transform;
}

/** 把 transform 读成数：用来看「整棵树在不在画布里、正不正中」，而不是钉死某一组像素。 */
function cameraValues(container: HTMLElement): { x: number; y: number; k: number } {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(
    cameraOf(container),
  );
  if (!m) throw new Error(`transform 读不出来：${cameraOf(container)}`);
  return { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) };
}

describe("路线树打开时的取景", () => {
  it("分岔的树开屏就整棵收进视野并居中", () => {
    // a 分出 b、c 两条枝：宽 340（两层）、高 284（两个兄弟）——远小于画布，取景倍数不放大。
    const cards = [card("a", null, 0), card("b", "a", 1), card("c", "a", 2)];
    const { container } = render(canvas(cards));
    // 居中：x = (1200 - 340) / 2，y = (800 - 284) / 2
    expect(cameraOf(container)).toBe("translate(430px, 258px) scale(1)");
  });

  it("整棵树落在画布里（留白之内），不压在边上", () => {
    const cards = [card("a", null, 0), card("b", "a", 1), card("c", "a", 2)];
    const { container } = render(canvas(cards));
    const { x, y, k } = cameraValues(container);
    const [treeW, treeH] = [340, 284];
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + treeW * k).toBeLessThanOrEqual(viewport.width);
    expect(y + treeH * k).toBeLessThanOrEqual(viewport.height);
    // 居中 = 两边剩下的空白一样宽
    expect(x - 0).toBeCloseTo(viewport.width - (x + treeW * k), 0);
    expect(y - 0).toBeCloseTo(viewport.height - (y + treeH * k), 0);
  });

  it("长链收不下时退回贴着根开始读", () => {
    // 13 张卡排成一条链：宽 2628，整棵收进视野要缩到 0.43——低于可读下限，宁可让人拖。
    const { container } = render(canvas(chain(13)));
    // 根仍贴着左边缘（x = 24），只在摊开方向（纵向）居中
    expect(cameraOf(container)).toBe("translate(24px, 348px) scale(1)");
  });

  it("树后来又长了也不抢镜头：首屏取景只做一次，observer 不重挂", () => {
    const { container, rerender } = render(canvas(chain(2)));
    const opened = cameraOf(container);
    expect(opened).toBe("translate(430px, 348px) scale(1)");
    expect(FakeResizeObserver.instances).toHaveLength(1);

    // 演下去多出几拍：布局尺寸变了，镜头留在玩家刚才看到的那一屏
    rerender(canvas(chain(4)));
    expect(cameraOf(container)).toBe(opened);
    // effect 若跟着布局尺寸换身份，observer 会重挂；浏览器对新 observe(el) 会补一次
    // 「刚观察」通知，那一下就会把镜头重置成新树的取景——数实例就是数这条来路。
    expect(FakeResizeObserver.instances).toHaveLength(1);
  });

  it("画布尺寸真的变了才重新取景", () => {
    const { container } = render(canvas(chain(2)));
    expect(cameraOf(container)).toBe("translate(430px, 348px) scale(1)");

    // 画布收窄到 600：整棵仍收得下，重新居中
    viewport = { width: 600, height: 800 };
    act(() => FakeResizeObserver.instances[0]!.trigger());
    expect(cameraOf(container)).toBe("translate(130px, 348px) scale(1)");
  });
});
