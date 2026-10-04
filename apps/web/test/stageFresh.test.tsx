// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "@aivn/core";
import { useStageSocket } from "../src/stage/useStageSocket.js";

/** jsdom 没有 WebSocket。装一个假壳，只留连接建立与投递下行两件事。 */
class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {}

  /** 模拟服务端下发一条消息。 */
  receive(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const HELLO: ServerMessage = {
  type: "hello",
  sessionId: "demo",
  lastSeq: 0,
  fresh: true,
  cast: [],
  voice: false,
  idle: true,
  saveId: "s1",
  saveName: "第 1 周目",
};

beforeEach(() => {
  FakeSocket.last = null;
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("空树的「开演」", () => {
  it("一轮开跑就不再是空树：卡片撤掉，状态转为演出中", () => {
    const { result } = renderHook(() => useStageSocket("demo"));
    const socket = FakeSocket.last!;

    act(() => socket.onopen?.());
    act(() => socket.receive(HELLO));
    expect(result.current.fresh).toBe(true);

    // 玩家按下画面上的「开演」：服务端开跑，回一条 beat_start（不会再补 hello）
    act(() => result.current.sendStart());
    expect(socket.sent.some((raw) => JSON.parse(raw).type === "start")).toBe(true);
    act(() => socket.receive({ type: "beat_start", beatId: "beat-1" }));

    expect(result.current.fresh).toBe(false);
    expect(result.current.state).toBe("streaming");
  });
});