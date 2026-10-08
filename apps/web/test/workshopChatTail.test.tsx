// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkshopTab } from "@aivn/stage";
import type { WorkshopInbound } from "../src/stage/useStageSocket.js";

const { WorkshopPane } = await import("../src/workshop/WorkshopPane.js");

type Props = Parameters<typeof WorkshopPane>[0];
type Inbound = (msg: WorkshopInbound) => void;

const HISTORY = [
  { role: "user" as const, text: "我想要一个赛博朋克侦探故事", at: 1 },
  { role: "assistant" as const, text: "先摆好舞台。", at: 2 },
  { role: "user" as const, text: "主角是个记不住人脸的女高中生", at: 3 },
];
const GEOM = { scrollHeight: 1000, clientHeight: 400 };
/** 浏览器里 scrollTop 不会超过 scrollHeight - clientHeight。 */
const maxTop = (): number => GEOM.scrollHeight - GEOM.clientHeight;
const BOTTOM = maxTop();

const originals = {
  scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!,
  scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!,
  clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!,
};
const tops = new WeakMap<Element, number>();
const isChat = (el: Element): boolean => el.classList.contains("workshop-chat");

/**
 * jsdom 不做布局：把「内容比视口高」按数值摆给对话滚动区——不摆的话 scrollHeight 恒 0，
 * 滚动位置无从谈起。加载在原型上（jsdom 把它们定义在 Element.prototype），
 * 页签来回切换后新挂上来的滚动区一样算数。
 */
function stubChatGeometry(): void {
  GEOM.scrollHeight = 1000;
  GEOM.clientHeight = 400;
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get(this: Element) {
      return isChat(this) ? GEOM.scrollHeight : 0;
    },
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get(this: Element) {
      return isChat(this) ? GEOM.clientHeight : 0;
    },
  });
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return tops.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      tops.set(this, Math.min(Math.max(value, 0), maxTop()));
    },
  });
}

afterEach(() => {
  cleanup();
  Object.defineProperty(Element.prototype, "scrollTop", originals.scrollTop);
  Object.defineProperty(Element.prototype, "scrollHeight", originals.scrollHeight);
  Object.defineProperty(Element.prototype, "clientHeight", originals.clientHeight);
});

/** 挂一个工坊（停在对话页），返回喂下行消息与切页签的入口。 */
function mountChat() {
  const handlers: Inbound[] = [];
  const scrollCalls: ScrollToOptions[] = [];
  let goTab: (tab: WorkshopTab) => void = () => undefined;

  stubChatGeometry();

  function Harness(props: Omit<Props, "tab" | "onTab">) {
    const [tab, setTab] = useState<WorkshopTab>("chat");
    goTab = setTab;
    return <WorkshopPane {...props} tab={tab} onTab={setTab} />;
  }

  const view = render(
    <Harness
      playId="p1"
      subscribe={(handler) => {
        handlers.push(handler as Inbound);
        return () => undefined;
      }}
      send={() => undefined}
      connected
      voice={{ on: false, available: false, onToggle: () => undefined }}
      continueCard={{ on: false, onToggle: () => undefined }}
    />,
  );

  const chat = (): HTMLElement => view.container.querySelector(".workshop-chat")!;
  chat().scrollTo = ((opts: ScrollToOptions) => {
    scrollCalls.push(opts);
    chat().scrollTop = opts.top ?? 0;
  }) as HTMLElement["scrollTo"];

  return {
    chat,
    scrollCalls,
    inbound: (msg: WorkshopInbound) => act(() => handlers.forEach((h) => h(msg))),
    switchTab: (tab: WorkshopTab) => act(() => goTab(tab)),
    /** 内容又长高了（新一行、图解码出来、流式增量）。 */
    grow: (px: number) => act(() => {
      GEOM.scrollHeight += px;
    }),
    /** 人自己往上翻：移动滚动位置再报一次滚动事件。 */
    scrollByUser: (scrollTop: number) =>
      act(() => {
        chat().scrollTop = scrollTop;
        fireEvent.scroll(chat());
      }),
  };
}

describe("工坊对话页：贴底跟随与回到顶部", () => {
  it("会话到手就落在底部，贴着底时不摆「回到顶部」键", () => {
    const { chat, inbound } = mountChat();
    inbound({ type: "workshop_history", threadId: "t1", messages: HISTORY, compaction: null });

    expect(chat().scrollTop).toBe(BOTTOM);
    expect(screen.queryByRole("button", { name: "回到顶部" })).toBeNull();
  });

  it("从别的页签回到对话页同样落在底部", () => {
    const { chat, inbound, switchTab } = mountChat();
    inbound({ type: "workshop_history", threadId: "t1", messages: HISTORY, compaction: null });

    switchTab("play");
    switchTab("chat");

    expect(chat().scrollTop).toBe(BOTTOM);
  });

  it("贴着底时内容长高（流式增量、图解码）继续跟着往下走", () => {
    const { chat, inbound, grow } = mountChat();
    inbound({ type: "workshop_history", threadId: "t1", messages: HISTORY, compaction: null });

    grow(200);
    inbound({ type: "workshop_chunk", threadId: "t1", delta: "正在写第一幕。" });

    expect(chat().scrollTop).toBe(BOTTOM + 200);
  });

  it("人往上翻过之后，新一行不再把他拽回底部，并露出「回到顶部」键", () => {
    const { chat, inbound, scrollByUser } = mountChat();
    inbound({ type: "workshop_history", threadId: "t1", messages: HISTORY, compaction: null });

    scrollByUser(120);
    expect(screen.getByRole("button", { name: "回到顶部" })).toBeTruthy();

    inbound({ type: "workshop_chunk", threadId: "t1", delta: "正在写第一幕。" });
    expect(chat().scrollTop).toBe(120);
  });

  it("「回到顶部」把会话滚回开头", () => {
    const { chat, inbound, scrollByUser, scrollCalls } = mountChat();
    inbound({ type: "workshop_history", threadId: "t1", messages: HISTORY, compaction: null });
    scrollByUser(120);

    fireEvent.click(screen.getByRole("button", { name: "回到顶部" }));

    expect(scrollCalls).toEqual([{ top: 0, behavior: "smooth" }]);
    expect(chat().scrollTop).toBe(0);
  });

  it("自己发的话一定看得见：翻上去过也吸回底部", () => {
    const { chat, inbound, scrollByUser } = mountChat();
    inbound({ type: "workshop_history", threadId: "t1", messages: HISTORY, compaction: null });
    scrollByUser(120);

    fireEvent.change(screen.getByPlaceholderText(/描述你想要的世界/), {
      target: { value: "再加一个雨夜的车站" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(chat().scrollTop).toBe(BOTTOM);
    expect(screen.queryByRole("button", { name: "回到顶部" })).toBeNull();
  });
});
