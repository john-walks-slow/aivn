// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaySummary } from "../src/api.js";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    agentModels: vi.fn(),
    listPlays: vi.fn(),
    playDetail: vi.fn(),
    listAssets: vi.fn(),
  },
}));
vi.mock("../src/api.js", () => ({ api: apiMock, coverUrl: () => null }));
vi.mock("../src/router.jsx", () => ({ navigate: vi.fn() }));

const { LibraryView } = await import("../src/views/LibraryView.js");

const DRAFT: PlaySummary = {
  id: "draft-a",
  title: "草稿一",
  premise: "一段还没开演的故事",
  readiness: { premise: false, sprites: false, background: false, started: false },
};

beforeEach(() => {
  apiMock.listPlays.mockResolvedValue([DRAFT]);
  apiMock.agentModels.mockResolvedValue([]);
  apiMock.playDetail.mockResolvedValue({ play: { cover: null } });
  apiMock.listAssets.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** 列表回来后才有空状态可言。 */
async function renderLibrary(): Promise<void> {
  render(<LibraryView />);
  await screen.findByText("草稿一");
}

describe("剧目库的空状态文案", () => {
  it("只切到「已开演」而没在搜：说清空的是哪一类，不留一颗点下去没反应的清除键", async () => {
    await renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: /已开演/ }));

    expect(screen.getByText("暂无已开演剧目")).toBeTruthy();
    expect(screen.queryByText(/没有找到与/)).toBeNull();
    expect(screen.queryByRole("button", { name: "清除搜索" })).toBeNull();
  });

  it("搜索无结果：仍是关键词的文案，并给一颗清除搜索的键", async () => {
    await renderLibrary();
    fireEvent.change(screen.getByPlaceholderText(/搜索剧目/), { target: { value: "不存在的剧" } });

    expect(screen.getByText("没有找到与“不存在的剧”相关的剧目。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    expect(screen.getByText("草稿一")).toBeTruthy();
  });

  it("已开演 + 关键词都没有命中：文案仍归关键词", async () => {
    await renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: /已开演/ }));
    fireEvent.change(screen.getByPlaceholderText(/搜索剧目/), { target: { value: "不存在的剧" } });

    expect(screen.getByText("没有找到与“不存在的剧”相关的剧目。")).toBeTruthy();
    expect(screen.queryByText("暂无已开演剧目")).toBeNull();
  });
});
