// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayConfig } from "@aivn/core";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    playDetail: vi.fn(),
    listFiles: vi.fn(),
    listAssets: vi.fn(),
    readFile: vi.fn(),
    craft: vi.fn(),
    voiceCatalog: vi.fn(),
    savePlay: vi.fn(),
    saveFile: vi.fn(),
  },
}));
vi.mock("../src/api.js", () => ({ api: apiMock }));

const { SettingsPane } = await import("../src/workshop/SettingsPane.js");

const PLAY = {
  id: "p1",
  title: "新剧目",
  characters: [],
  opening: "（游戏开始，请演出第一轮）",
  initialState: { turn: 0, affinity: {}, flags: {} },
  initialScene: "未定",
} as unknown as PlayConfig;

/** 新剧目落盘的两个空文件（服务端 createEmpty 建的就是这两个）。 */
const FILES = [
  { path: "memory/always/craft.md", dir: ["memory", "always"], size: 0, writable: true, kind: "text" },
  { path: "memory/always/premise.md", dir: ["memory", "always"], size: 0, writable: true, kind: "text" },
  { path: "play.json", dir: [], size: 219, writable: true, kind: "text" },
];

/** 可手动兑现的 promise，用来控制两个请求谁先回来。 */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** 卡片标题与展开区 h3 同名，这里只认卡片（.setting-card 内的那一份）。 */
function cardTitles(): string[] {
  const cards = document.querySelectorAll(".setting-card");
  return [...cards].map((el) => el.querySelector(".setting-card-title")?.textContent ?? "");
}

/** 两份常驻设定同 rank，排序只保证「剧目在最前」，彼此先后不作数。 */
const EXPECTED = expect.arrayContaining(["剧目", "世界与人物设定", "创作口径"]);

describe("设定与记忆页：两份请求无论谁先回来都要出卡", () => {
  beforeEach(() => {
    apiMock.listAssets.mockResolvedValue({});
    apiMock.readFile.mockResolvedValue({ path: "memory/always/premise.md", content: "" });
    apiMock.craft.mockResolvedValue({ content: "" });
    apiMock.voiceCatalog.mockResolvedValue({ entries: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("files 先回、detail 后回（并发竞态）", async () => {
    const detail = deferred<{ play: PlayConfig }>();
    apiMock.playDetail.mockReturnValue(detail.promise);
    apiMock.listFiles.mockResolvedValue(FILES);

    render(<SettingsPane playId="p1" revision={0} />);
    await waitFor(() => expect(apiMock.listFiles).toHaveBeenCalled());

    detail.resolve({ play: PLAY });

    await waitFor(() => expect(cardTitles()).toEqual(EXPECTED));
    expect(cardTitles()).toHaveLength(3);
  });

  it("detail 先回、files 后回", async () => {
    apiMock.playDetail.mockResolvedValue({ play: PLAY });
    apiMock.listFiles.mockResolvedValue(FILES);

    render(<SettingsPane playId="p1" revision={0} />);

    await waitFor(() => expect(cardTitles()).toEqual(EXPECTED));
    expect(cardTitles()).toHaveLength(3);
  });

  it("默认展开的是世界与人物设定，不是空态提示", async () => {
    apiMock.playDetail.mockResolvedValue({ play: PLAY });
    apiMock.listFiles.mockResolvedValue(FILES);

    render(<SettingsPane playId="p1" revision={0} />);

    await waitFor(() => expect(cardTitles()).toHaveLength(3));
    expect(screen.queryByText("选一张设定卡开始读或改。")).toBeNull();
    expect(apiMock.readFile).toHaveBeenCalledWith("p1", "memory/always/premise.md");
  });
});