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

  it("没有周目时：只显示「开始」，不显示「继续」「周目」「开始新周目」", async () => {
    vi.spyOn(api, "listSaves").mockResolvedValue([]);

    render(<TitleView playId="demo" />);

    await waitFor(() => {
      expect(screen.getByText("开始")).toBeTruthy();
    });

    expect(screen.queryByText("继续")).toBeNull();
    expect(screen.queryByText("周目")).toBeNull();
    expect(screen.queryByText("开始新周目")).toBeNull();
  });

  it("已有周目时：只显示「继续」，不显示「开始」「周目」「开始新周目」", async () => {
    const mockSaves: SaveInfo[] = [
      { id: "s1", name: "第 1 周目", current: true, updatedAt: 123 },
    ];
    vi.spyOn(api, "listSaves").mockResolvedValue(mockSaves);

    render(<TitleView playId="demo" />);

    await waitFor(() => {
      expect(screen.getByText("继续")).toBeTruthy();
      expect(screen.queryByText("开始")).toBeNull();
    });

    expect(screen.queryByText("周目")).toBeNull();
    expect(screen.queryByText("开始新周目")).toBeNull();
  });
});
