// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TitleView } from "../src/views/TitleView.js";
import { api, type PlayDetail } from "../src/api.js";

const DUMMY_PLAY: PlayDetail = {
  play: { title: "测试剧目", cover: null },
  premise: "测试前提",
  cast: [],
  readiness: {
    premise: true,
    sprites: true,
    background: true,
    started: false,
  },
};

/** 缺项的那份：前提没写、立绘目录空、背景目录也空。 */
const MISSING_PLAY: PlayDetail = {
  ...DUMMY_PLAY,
  readiness: { premise: false, sprites: false, background: false, started: false },
};

describe("TitleView 菜单项", () => {
  beforeEach(() => {
    vi.spyOn(api, "playDetail").mockResolvedValue(DUMMY_PLAY);
    vi.spyOn(api, "listAssets").mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("没有历史时：START 显示开始游戏，不出现继续与路线入口", async () => {
    render(<TitleView playId="demo" />);

    await waitFor(() => expect(screen.getByText("START")).toBeTruthy());

    expect(screen.getByText("开始游戏")).toBeTruthy();
    expect(screen.queryByText("CONTINUE")).toBeNull();
    expect(screen.queryByText("LOAD")).toBeNull();
    expect(screen.queryByText("ROUTE")).toBeNull();
  });

  it("已有历史时：START 显示新的开始，路线入口出现", async () => {
    vi.spyOn(api, "playDetail").mockResolvedValue({
      ...DUMMY_PLAY,
      readiness: { ...DUMMY_PLAY.readiness, started: true },
    });

    render(<TitleView playId="demo" />);

    await waitFor(() => expect(screen.getByText("START")).toBeTruthy());

    expect(screen.getByText("新的开始")).toBeTruthy();
    expect(screen.getByText("ROUTE")).toBeTruthy();
    expect(screen.getByText("路线树")).toBeTruthy();
    expect(screen.queryByText("CONTINUE")).toBeNull();
    expect(screen.queryByText("LOAD")).toBeNull();
  });

  it("缺项时：WORKSHOP 入口旁一句推荐注，且副标让位", async () => {
    vi.spyOn(api, "playDetail").mockResolvedValue(MISSING_PLAY);

    render(<TitleView playId="demo" />);

    await waitFor(() => {
      expect(screen.getByText("WORKSHOP")).toBeTruthy();
    });

    const entry = screen.getByText("WORKSHOP").closest("button");
    expect(entry?.querySelector(".atri-hint")?.textContent).toBe(
      "去补齐故事前提、立绘、背景图",
    );
    // 推荐注是入口这颗按钮里的一句字，不是并排的第二枚 CTA
    expect(entry?.querySelectorAll(".atri-hint").length).toBe(1);
    // 副标不再有：既不是「工坊」，也没被推荐注顶到副标的位置上
    expect(entry?.querySelector(".atri-sub")).toBeNull();
    expect(screen.queryByText("工坊")).toBeNull();
  });

  it("只缺图时：推荐注只列真正缺的那两项", async () => {
    vi.spyOn(api, "playDetail").mockResolvedValue({
      ...MISSING_PLAY,
      readiness: {
        premise: true,
        sprites: false,
        background: false,
        started: false,
      },
    });

    render(<TitleView playId="demo" />);

    await waitFor(() => {
      expect(screen.getByText("去补齐立绘、背景图")).toBeTruthy();
    });
  });

  it("什么都不缺时：WORKSHOP 带着工坊副标，没有推荐注", async () => {
    render(<TitleView playId="demo" />);

    await waitFor(() => {
      expect(screen.getByText("WORKSHOP")).toBeTruthy();
    });

    const entry = screen.getByText("WORKSHOP").closest("button");
    expect(entry?.querySelector(".atri-hint")).toBeNull();
    expect(entry?.querySelector(".atri-sub")?.textContent).toBe("工坊");
  });

  it("焦点环按输入方式发牌：首屏的 autoFocus 不挂，Tab 之后才挂，点一下就收", async () => {
    render(<TitleView playId="demo" />);

    await waitFor(() => {
      expect(screen.getByText("START")).toBeTruthy();
    });

    const menu = document.querySelector(".atri-menu");
    // 自动聚焦是给 Enter 用的落点，不是键盘导航——环挂在菜单上就等于给「绿框」
    expect(menu?.classList.contains("is-keyboard")).toBe(false);

    fireEvent.keyDown(window, { key: "Tab" });
    expect(menu?.classList.contains("is-keyboard")).toBe(true);

    fireEvent.pointerDown(window);
    expect(menu?.classList.contains("is-keyboard")).toBe(false);
  });
});
