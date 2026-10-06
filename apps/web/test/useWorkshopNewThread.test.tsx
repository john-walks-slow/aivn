// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { useWorkshop } = await import("../src/workshop/useWorkshop.js");

afterEach(cleanup);

/** 挂一个 useWorkshop，把 outbound send 收集起来，inbound 消息喂给 hook。 */
function mount() {
  const outbound: unknown[] = [];
  const probe: { current: ReturnType<typeof useWorkshop> | null } = { current: null };
  function Probe() {
    probe.current = useWorkshop((msg) => outbound.push(msg));
    return null;
  }
  render(<Probe />);

  function inbound(msg: unknown) {
    act(() => probe.current?.onMessage(msg as Parameters<ReturnType<typeof useWorkshop>["onMessage"]>[0]));
  }

  return {
    outbound,
    api: () => probe.current!,
    send: (m: unknown) => act(() => outbound.push(m)),
    inbound,
  };
}

const THREAD = { id: "t1", title: "赛博朋克", at: 1 };

describe("点「新会话」后旧历史不残留", () => {
  it("newThread 只标记待发，不动已有历史（等待第一条消息由服务端 history 替换）", () => {
    const { api, inbound } = mount();
    inbound({ type: "workshop_history", threadId: "t1", messages: [{ role: "user", text: "旧消息", at: 1 }] });
    expect(api().state.messages).toHaveLength(1);

    act(() => api().newThread());

    // 旧行为坑：标记了但历史还在，旧对话继续挂在「新会话」标题下直到 history 换掉
    expect(api().state.messages).toHaveLength(1);
    expect(api().freshThread).toBe(true);
  });

  it("clearState 清掉聊天区但保住线程列表", () => {
    const { api, inbound } = mount();
    inbound({ type: "workshop_threads", threads: [THREAD], activeId: "t1" });
    inbound({ type: "workshop_history", threadId: "t1", messages: [{ role: "user", text: "旧消息", at: 1 }] });
    inbound({ type: "workshop_write", threadId: "t1", path: "memory/always/craft.md", before: "旧内容" });

    act(() => api().clearState());

    expect(api().state.messages).toEqual([]);
    expect(api().state.live).toEqual([]);
    expect(api().state.busy).toBe(false);
    // 会话层不能跟着消失：列表与当前会话要留着；写盘只涨 revision，不留记录
    expect(api().state.threads).toEqual([THREAD]);
    expect(api().state.activeId).toBe("t1");
    expect(api().state.revision).toBe(1);
  });

  it("清空后发出的第一条消息不带 threadId，服务端据此新建会话", () => {
    const { outbound, api, inbound } = mount();
    inbound({ type: "workshop_threads", threads: [THREAD], activeId: "t1" });
    inbound({ type: "workshop_history", threadId: "t1", messages: [{ role: "user", text: "旧消息", at: 1 }] });

    act(() => {
      api().clearState();
      api().newThread();
    });
    act(() => api().chat("新话题"));

    const chatMsg = outbound.find((m) => (m as { type: string }).type === "workshop_chat");
    expect(chatMsg).toBeDefined();
    // activeId 被清空了也不能让服务端误判成「往旧会话续写」
    expect((chatMsg as { threadId?: string }).threadId).toBeUndefined();
    expect(api().freshThread).toBe(false);
  });

  it("不点新会话时按原样续写当前会话", () => {
    const { outbound, api, inbound } = mount();
    inbound({ type: "workshop_threads", threads: [THREAD], activeId: "t1" });
    inbound({ type: "workshop_history", threadId: "t1", messages: [{ role: "user", text: "旧消息", at: 1 }] });

    act(() => api().chat("继续聊"));

    const chatMsg = outbound.find((m) => (m as { type: string }).type === "workshop_chat");
    expect((chatMsg as { threadId?: string }).threadId).toBe("t1");
  });

  it("clearState 不影响 activate：切回旧会话仍能拿到服务端 history", () => {
    const { outbound, api, inbound } = mount();
    inbound({ type: "workshop_threads", threads: [THREAD], activeId: "t1" });
    act(() => api().clearState());
    act(() => api().activate("t1"));
    expect(outbound).toContainEqual({ type: "workshop_activate", threadId: "t1" });
  });
});
