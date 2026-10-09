// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

const { useWorkshop } = await import("../src/workshop/useWorkshop.js");

afterEach(cleanup);

type Inbound = Parameters<ReturnType<typeof useWorkshop>["onMessage"]>[0];

/** 挂一个 useWorkshop，inbound 消息直接喂给 hook。 */
function mount() {
  const probe: { current: ReturnType<typeof useWorkshop> | null } = { current: null };
  function Probe() {
    probe.current = useWorkshop(() => {});
    return null;
  }
  render(<Probe />);
  return {
    api: () => probe.current!,
    inbound: (msg: unknown) => act(() => probe.current?.onMessage(msg as Inbound)),
  };
}

/**
 * 走一遍真实的握手：服务端在 `workshop_open` 之后先发线程列表、再发当前线程的历史。
 *
 * **必须先开一条线程**：`workshop_*` 的下行事件一律按 `threadId !== activeId` 过滤
 * （后台线程的 token 不能串进当前会话，见 2026-10-08 的流式串台修复 `9993dd9e`），
 * activeId 还是 null 时这些消息一条都落不进 state。
 */
function openThread(inbound: (msg: unknown) => void, threadId = "t1"): void {
  inbound({ type: "workshop_threads", threads: [{ id: threadId, title: "赛博朋克", at: 1 }], activeId: threadId });
  inbound({ type: "workshop_history", threadId, messages: [] });
}

const ASSET = { kind: "cg" as const, path: "assets/cg/rooftop.jpg", url: "/plays/test/assets/cg/rooftop.jpg" };

describe("工坊段落流：思考、工具与素材", () => {
  it("思考与工具按发生顺序拼成段落，结束按调用号补上结果", () => {
    const { api, inbound } = mount();
    openThread(inbound);
    inbound({ type: "workshop_thinking", threadId: "t1", delta: "先读一眼" });
    inbound({ type: "workshop_thinking", threadId: "t1", delta: " play.json" });
    inbound({ type: "workshop_tool_start", threadId: "t1", id: "c1", name: "read", args: { path: "play.json" } });
    inbound({ type: "workshop_tool_end", threadId: "t1", id: "c1", result: "文件内容", isError: false, ms: 12 });
    inbound({ type: "workshop_chunk", threadId: "t1", delta: "看过了。" });

    const live = api().state.live;
    expect(live.map((p) => p.type)).toEqual(["thinking", "tool", "text"]);
    expect(live[0]).toEqual({ type: "thinking", text: "先读一眼 play.json" });
    expect(live[1]).toMatchObject({ type: "tool", id: "c1", name: "read", result: "文件内容", ms: 12 });
    expect(api().state.busy).toBe(true);
  });

  it("收束时用服务端的权威段落整段换掉流式现场", () => {
    const { api, inbound } = mount();
    openThread(inbound);
    inbound({ type: "workshop_chunk", threadId: "t1", delta: "流式里的半截" });
    inbound({
      type: "workshop_done",
      threadId: "t1",
      text: "定稿正文",
      parts: [{ type: "text", text: "定稿正文" }],
      images: [],
    });

    expect(api().state.live).toEqual([]);
    expect(api().state.busy).toBe(false);
    expect(api().state.messages).toHaveLength(1);
    expect(api().state.messages[0]!.parts).toEqual([{ type: "text", text: "定稿正文" }]);
  });

  it("素材带调用号的挂到那一行上，不带号的落在消息级预览里", () => {
    const { api, inbound } = mount();
    openThread(inbound);
    inbound({ type: "workshop_tool_start", threadId: "t1", id: "c1", name: "generate_image", args: {} });
    inbound({ type: "workshop_asset", threadId: "t1", toolCallId: "c1", replaced: false, ...ASSET });
    inbound({ type: "workshop_asset", threadId: "t1", replaced: false, ...ASSET });

    const tool = api().state.live[0] as { assets?: unknown[] };
    expect(tool.assets).toEqual([ASSET]);
    expect(api().state.pendingAssets).toEqual([ASSET]);
  });

  it("半途失败也把已经发生的段落与素材留着（服务端随后补发的 history 会接管）", () => {
    const { api, inbound } = mount();
    openThread(inbound);
    inbound({ type: "workshop_chunk", threadId: "t1", delta: "我看看" });
    inbound({
      type: "workshop_error",
      threadId: "t1",
      message: "模型返回空内容",
      parts: [{ type: "text", text: "我看看" }],
      images: [ASSET],
    });

    expect(api().state.busy).toBe(false);
    expect(api().state.error).toBe("模型返回空内容");
    expect(api().state.live).toEqual([{ type: "text", text: "我看看" }]);
    expect(api().state.pendingAssets).toEqual([ASSET]);
  });

  /**
   * 串台回归：当前会话是 t1 时，后台那条 t2 的流式片段、工具行、素材、收束都不许进现场。
   * 这条是 `9993dd9e` 修的那个 bug 的守卫，也是 `f58381e1` 的检视报告点名缺的单测（SUG-02）。
   */
  it("别的线程的片段不串进当前会话", () => {
    const { api, inbound } = mount();
    openThread(inbound);

    inbound({ type: "workshop_chunk", threadId: "t2", delta: "后台的 token" });
    inbound({ type: "workshop_thinking", threadId: "t2", delta: "后台在想" });
    inbound({ type: "workshop_tool_start", threadId: "t2", id: "c9", name: "read", args: {} });
    inbound({ type: "workshop_asset", threadId: "t2", replaced: false, ...ASSET });
    expect(api().state.live).toEqual([]);
    expect(api().state.pendingAssets).toEqual([]);

    // 收束只复位现场：t2 的结果不许落成 t1 的消息
    inbound({ type: "workshop_done", threadId: "t2", text: "后台的定稿", parts: [{ type: "text", text: "后台的定稿" }], images: [] });
    expect(api().state.messages).toEqual([]);

    // 当前线程自己的一条照常进得来（别把过滤写成「一概不收」）
    inbound({ type: "workshop_chunk", threadId: "t1", delta: "前台的字" });
    expect(api().state.live).toEqual([{ type: "text", text: "前台的字" }]);
  });
});
