// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TitleView } from "../src/views/TitleView.js";
import { api, type PlayDetail, type SaveInfo } from "../src/api.js";

const DUMMY_PLAY: PlayDetail = {
  play: { title: "测试剧目", cover: null },
  premise: "测试前提",
  cast: [],
  readiness: {
    premise: true,
    cast: true,
    world: true,
    craft: true,
    sprites: 0,
    backgrounds: 0,
    cg: 0,
    bgm: 0,
    sfx: 0,
    saves: 0,
    voiceCount: 0,
  },
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
});
