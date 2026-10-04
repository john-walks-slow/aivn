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

const ASSET = { kind: "cg" as const, path: "assets/cg/rooftop.jpg", url: "/plays/test/assets/cg/rooftop.jpg" };

describe("工坊段落流：思考、工具与素材", () => {
  it("思考与工具按发生顺序拼成段落，结束按调用号补上结果", () => {
    const { api, inbound } = mount();
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
    inbound({ type: "workshop_tool_start", threadId: "t1", id: "c1", name: "generate_image", args: {} });
    inbound({ type: "workshop_asset", threadId: "t1", toolCallId: "c1", replaced: false, ...ASSET });
    inbound({ type: "workshop_asset", threadId: "t1", replaced: false, ...ASSET });

    const tool = api().state.live[0] as { assets?: unknown[] };
    expect(tool.assets).toEqual([ASSET]);
    expect(api().state.pendingAssets).toEqual([ASSET]);
  });

  it("半途失败也把已经发生的段落与素材留着（服务端随后补发的 history 会接管）", () => {
    const { api, inbound } = mount();
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
});
