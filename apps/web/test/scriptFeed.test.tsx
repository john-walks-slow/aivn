// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LineageNodeView, LineageView, TranscriptEntry } from "@aivn/core";

const { buildScriptFeed, BacklogView } = await import("@aivn/stage");

const node = (
  id: string,
  kind: LineageNodeView["kind"],
  seq: number,
  extra: Partial<LineageNodeView> = {},
): LineageNodeView =>
  ({
    id,
    parentId: null,
    kind,
    turn: 1,
    text: "",
    attrs: {},
    createdAt: 0,
    onPath: true,
    children: 0,
    editedText: null,
    editCount: 0,
    editedAt: undefined,
    seq,
    cgs: [],
    ...extra,
  }) as LineageNodeView;

const view: LineageView = {
  nodes: [
    node("n1", "scene", 1, { attrs: { bg: "classroom", bgm: "daily" } }),
    node("n2", "say", 2),
    node("n3", "actor", 3, { attrs: { id: "mio", variant: "smile" } }),
    node("n4", "narrate", 4),
    node("n5", "cg", 5, { attrs: { id: "cg_roof" } }),
    node("n6", "prompt", 6, { text: "去天台" }),
    node("n7", "sfx", 7, { attrs: { src: "wind" } }),
    node("n8", "stop", 8, { stopType: "choice", stopOptions: [{ text: "走过去" }, { text: "站着不动" }] }),
  ],
  pathIds: ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"],
} as unknown as LineageView;

const entries: TranscriptEntry[] = [
  { key: "l2", kind: "line", type: "say", actorId: "mio", text: "早上好。", seq: 2, nodeId: "n2" },
  { key: "l4", kind: "line", type: "narrate", actorId: null, text: "风把窗帘吹了起来。", seq: 4, nodeId: "n4" },
  { key: "i6", kind: "input", type: "say", actorId: "player", text: "去天台", seq: 6, nodeId: null },
];

describe("剧本 feed：台词与舞台指令按演出顺序铺开", () => {
  it("布景指令排在它自己的位置上，一个不漏", () => {
    const feed = buildScriptFeed(view, entries, { mio: "澪" });
    expect(feed.map((f) => (f.kind === "line" ? f.entry.text : f.direction.label))).toEqual([
      "换景",
      "早上好。",
      "立绘",
      "风把窗帘吹了起来。",
      "插图",
      "去天台",
      "音效",
      "停止点",
    ]);
  });

  it("指令写的是人话 + 素材名，不出现标签名", () => {
    const feed = buildScriptFeed(view, entries, { mio: "澪" });
    const dirs = feed.filter((f) => f.kind === "direction").map((f) => (f.kind === "direction" ? f.direction : null));
    expect(dirs.map((d) => d?.detail)).toEqual([
      "classroom · 音乐 daily",
      "澪 · 差分 smile",
      "cg_roof",
      "wind",
      "2 个选项",
    ]);
    expect(JSON.stringify(feed)).not.toContain("<scene");
  });

  it("没有谱系时退化成台词列表（宿主与老档的兜底）", () => {
    const feed = buildScriptFeed(null, entries);
    expect(feed).toHaveLength(3);
    expect(feed.every((f) => f.kind === "line")).toBe(true);
  });
});

describe("剧本面板渲染", () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });
  afterEach(cleanup);

  it("指令行走指令样式，台词行走台词样式", () => {
    const feed = buildScriptFeed(view, entries, { mio: "澪" });
    render(
      <BacklogView
        entries={entries}
        feed={feed}
        names={{ mio: "澪" }}
        headKey="l2"
        busy={false}
        voiceAvailable={false}
        voiceState={() => "idle"}
        beatFor={() => null}
        onSeek={() => {}}
        onReplay={() => {}}
        onEdit={() => {}}
        onFork={() => {}}
      />,
    );
    expect(document.querySelectorAll(".bl-dir")).toHaveLength(5);
    expect(document.querySelectorAll(".backlog-list > li")).toHaveLength(8);
    expect(document.querySelector(".bl-dir-stop .bl-dir-option")?.textContent).toBe("走过去");
  });

  it("有语音的台词挂一枚喇叭徽章，没有的不挂", () => {
    render(
      <BacklogView
        entries={entries}
        names={{ mio: "澪" }}
        headKey={null}
        busy={false}
        voiceAvailable
        voiceState={(seq) => (seq === 2 ? "ready" : "idle")}
        beatFor={() => null}
        onSeek={() => {}}
        onReplay={() => {}}
        onEdit={() => {}}
        onFork={() => {}}
      />,
    );
    const badges = [...document.querySelectorAll(".bl-voice")];
    expect(badges).toHaveLength(1);
    // 圆徽章只有喇叭图标、没有字（写成「回听」胶囊被用户否了）
    expect(badges[0]?.textContent).toBe("");
    expect(badges[0]?.querySelector("svg")).toBeTruthy();
    fireEvent.click(badges[0] as HTMLElement);
    expect(screen.getByRole("button", { name: "重听这句" })).toBeTruthy();
  });
});
