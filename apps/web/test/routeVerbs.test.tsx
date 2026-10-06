// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LineageNodeView } from "@aivn/core";
import type { BeatCard } from "../src/stage/beats.js";
import type { LineageOps } from "../src/stage/LineagePanel.js";
import { RouteCanvas } from "../src/stage/RouteCanvas.js";

/** 一轮一卡；`nodes` 只用于「这张卡覆盖几个谱系节点」与取首节点 id，给最小形状即可。 */
function card(id: string, parentId: string | null, turn: number, heads: string[]): BeatCard {
  return {
    id,
    startNodeId: heads[0]!,
    endNodeId: heads[heads.length - 1]!,
    forkFromId: parentId ?? heads[0]!,
    turn,
    nodes: heads.map((nodeId) => ({ id: nodeId }) as LineageNodeView),
    preview: id,
    speakers: [],
    at: turn,
    sceneBg: null,
    cgId: null,
    stopType: null,
    startSeq: turn,
    endSeq: turn,
    onPath: true,
    isLeaf: false,
    isAbandoned: false,
    depth: 0,
    parentId,
    forkedFrom: null,
  };
}

/** 根 → 中 → 梢（一条链，中段删除会波及梢）。 */
const ROOT = card("c0", null, 0, ["n0"]);
const MID = card("c1", "c0", 1, ["n1", "n1b"]);
const TAIL = card("c2", "c1", 2, ["n2"]);
const CARDS = [ROOT, MID, TAIL];

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

function setup(over: Partial<LineageOps> = {}): {
  container: HTMLElement;
  ops: { jump: ReturnType<typeof vi.fn>; rewrite: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
} {
  const ops = {
    jump: vi.fn(),
    rewrite: vi.fn(),
    remove: vi.fn(),
    ...over,
  } as unknown as {
    jump: ReturnType<typeof vi.fn>;
    rewrite: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  const { container } = render(
    <RouteCanvas
      cards={CARDS}
      ops={ops as unknown as LineageOps}
      busy={false}
      names={{}}
      index={null}
      onControls={() => {}}
    />,
  );
  return { container, ops };
}

/** 弹窗页脚上的那个键：卡面上的同名动词长得一样，只能按弹窗范围找。 */
function modalButton(label: string): HTMLElement {
  return [...document.body.querySelectorAll<HTMLElement>(".modal-foot button")].find(
    (btn) => btn.textContent === label,
  )!;
}

/** 第 n 张卡（DOM 顺序 = cards 顺序）。 */
function cardAt(container: HTMLElement, index: number): HTMLElement {
  return container.querySelectorAll<HTMLElement>(".route-node")[index]!;
}

function toolAt(container: HTMLElement, cardIndex: number, label: string): HTMLElement {
  return [...cardAt(container, cardIndex).querySelectorAll<HTMLElement>(".route-node-tool")].find(
    (btn) => btn.textContent?.trim() === label,
  )!;
}

describe("路线卡的三个动词", () => {
  it("卡面上只有 跳转 / 重写 / 删除，且三个都说清「生不生成」", () => {
    const { container } = setup();
    const labels = [...cardAt(container, 0).querySelectorAll(".route-node-tool")].map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toEqual(["跳转", "重写", "删除"]);
    expect(toolAt(container, 0, "跳转").title).toContain("不重新生成");
    expect(toolAt(container, 0, "重写").title).toContain("重新写一遍");
    expect(toolAt(container, 0, "删除").title).toContain("全部内容");
  });

  it("跳转回到这一段的开头（playFrom=start），不重新生成", () => {
    const { container, ops } = setup();
    fireEvent.click(toolAt(container, 1, "跳转"));
    expect(ops.jump).toHaveBeenCalledWith(MID.endNodeId, { playFrom: "start" });
  });

  it("重写：弹输入框，留空就是纯重写，填了就带上那句交代", () => {
    const { container, ops } = setup();
    fireEvent.click(toolAt(container, 1, "重写"));
    const input = document.body.querySelector<HTMLInputElement>(".route-modal-input")!;
    expect(input).not.toBeNull();

    fireEvent.change(input, { target: { value: "让她的反应更冷淡一点" } });
    fireEvent.click(modalButton("重写"));

    expect(ops.rewrite).toHaveBeenCalledWith(MID.forkFromId, {
      replaced: MID.nodes[0]!.id,
      instruction: "让她的反应更冷淡一点",
    });
  });

  it("重写留空：只退到这一段之前重新生成，不带交代", () => {
    const { container, ops } = setup();
    fireEvent.click(toolAt(container, 1, "重写"));
    fireEvent.click(modalButton("重写"));
    expect(ops.rewrite).toHaveBeenCalledWith(MID.forkFromId, { replaced: MID.nodes[0]!.id });
  });

  it("删除要先确认：弹窗说清会没掉多少，确认才真的剪", () => {
    const { container, ops } = setup();
    fireEvent.click(toolAt(container, 1, "删除"));

    // 中段及其后代 = 2 轮 / 3 个节点（中段自己两个节点 + 梢那一个）
    const note = document.body.querySelector(".route-modal-note")!;
    expect(note.textContent).toContain("2");
    expect(note.textContent).toContain("3");
    expect(ops.remove).not.toHaveBeenCalled();

    fireEvent.click(modalButton("删除"));
    expect(ops.remove).toHaveBeenCalledWith(MID.nodes[0]!.id);
  });

  it("取消不动树", () => {
    const { container, ops } = setup();
    fireEvent.click(toolAt(container, 2, "删除"));
    fireEvent.click(modalButton("取消"));
    expect(ops.remove).not.toHaveBeenCalled();
  });

  it("哨兵卡片只有「跳转」，不能删除与重写", () => {
    const sentinelCard: BeatCard = {
      ...ROOT,
      id: "root",
      isSentinel: true,
      preview: "开端",
    };
    const { container } = render(
      <RouteCanvas
        cards={[sentinelCard, MID]}
        ops={{ jump: vi.fn(), rewrite: vi.fn(), remove: vi.fn() } as unknown as LineageOps}
        busy={false}
        names={{}}
        index={null}
        onControls={() => {}}
      />,
    );
    const sentinelElement = container.querySelectorAll<HTMLElement>(".route-node")[0]!;
    expect(sentinelElement.classList.contains("sentinel")).toBe(true);
    const labels = [...sentinelElement.querySelectorAll(".route-node-tool")].map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toEqual(["跳转"]);
  });
});

describe("点卡片选中：照出这一段的来路与去路", () => {
  it("选中中段：自己描边、根是来路（kin）、梢是去路（doomed，也就是删掉会没掉的范围）", () => {
    const { container } = setup();
    fireEvent.click(cardAt(container, 1));
    expect(cardAt(container, 1).classList.contains("selected")).toBe(true);
    expect(cardAt(container, 0).classList.contains("kin")).toBe(true);
    expect(cardAt(container, 2).classList.contains("doomed")).toBe(true);
    expect(container.querySelectorAll(".route-edge.kin")).toHaveLength(1);
    expect(container.querySelectorAll(".route-edge.doomed")).toHaveLength(1);
  });

  it("点画布空白取消选中", () => {
    const { container } = setup();
    fireEvent.click(cardAt(container, 1));
    expect(container.querySelector(".route-node.selected")).not.toBeNull();
    fireEvent.click(container.querySelector(".route-viewport")!);
    expect(container.querySelector(".route-node.selected")).toBeNull();
  });
});
