// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TitleView } from "../src/views/TitleView.js";
import { api, type PlayDetail, type SaveInfo } from "../src/api.js";

const DUMMY_PLAY: PlayDetail = {
  play: { title: "测试剧目", cover: null },
  premise: "测试前提",
  cast: [],
  readiness: {
    premise: true,
    sprites: true,
    background: true,
    saves: 0,
  },
};

/** 缺项的那份：前提没写、立绘目录空、背景目录也空。 */
const MISSING_PLAY: PlayDetail = {
  ...DUMMY_PLAY,
  readiness: { premise: false, sprites: false, background: false, saves: 0 },
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

  it("没有周目时：只有 START，没有 CONTINUE / LOAD", async () => {
    vi.spyOn(api, "listSaves").mockResolvedValue([]);

    render(<TitleView playId="demo" />);

    await waitFor(() => {
      expect(screen.getByText("START")).toBeTruthy();
    });

    // 菜单是一列纯字（ATRI 那一版）：没档就没有 CONTINUE，LOAD 也在没档时禁用
    expect(screen.queryByText("CONTINUE")).toBeNull();
    expect(screen.getByText("LOAD").closest("button")?.disabled).toBe(true);
  });

  it("已有周目时：CONTINUE 在最前，START 与它并列但不再是首位", async () => {
    const mockSaves: SaveInfo[] = [
      { id: "s1", name: "第 1 周目", current: true, updatedAt: 123 },
    ];
    vi.spyOn(api, "listSaves").mockResolvedValue(mockSaves);

    render(<TitleView playId="demo" />);

    await waitFor(() => {
      expect(screen.getByText("CONTINUE")).toBeTruthy();
      expect(screen.getByText("START")).toBeTruthy();
    });

    // CONTINUE 排在 START 之前：菜单顺序就是玩家的选择顺序
    const menu = document.querySelector(".atri-menu");
    const labels = [...(menu?.querySelectorAll(".atri-label") ?? [])].map((el) => el.textContent);
    expect(labels.indexOf("CONTINUE")).toBeLessThan(labels.indexOf("START"));
    expect(screen.getByText("LOAD").closest("button")?.disabled).toBe(false);
  });

  it("缺项时：WORKSHOP 入口旁一句推荐注，且不恢复 STUDIO 副标", async () => {
    vi.spyOn(api, "listSaves").mockResolvedValue([]);
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
    // 副标不再有：既不是 STUDIO，也没被推荐注顶到副标的位置上
    expect(entry?.querySelector(".atri-sub")).toBeNull();
    expect(screen.queryByText("STUDIO")).toBeNull();
  });

  it("只缺图时：推荐注只列真正缺的那两项", async () => {
    vi.spyOn(api, "listSaves").mockResolvedValue([]);
    vi.spyOn(api, "playDetail").mockResolvedValue({
      ...MISSING_PLAY,
      readiness: { premise: true, sprites: false, background: false, saves: 0 },
    });

    render(<TitleView playId="demo" />);

    await waitFor(() => {
      expect(screen.getByText("去补齐立绘、背景图")).toBeTruthy();
    });
  });

  it("什么都不缺时：WORKSHOP 带着 STUDIO 副标，没有推荐注", async () => {
    vi.spyOn(api, "listSaves").mockResolvedValue([]);

    render(<TitleView playId="demo" />);

    await waitFor(() => {
      expect(screen.getByText("WORKSHOP")).toBeTruthy();
    });

    const entry = screen.getByText("WORKSHOP").closest("button");
    expect(entry?.querySelector(".atri-hint")).toBeNull();
    expect(entry?.querySelector(".atri-sub")?.textContent).toBe("STUDIO");
  });

  it("焦点环按输入方式发牌：首屏的 autoFocus 不挂，Tab 之后才挂，点一下就收", async () => {
    vi.spyOn(api, "listSaves").mockResolvedValue([]);

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
