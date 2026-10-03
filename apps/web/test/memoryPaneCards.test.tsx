// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    listFiles: vi.fn(),
    readFile: vi.fn(),
    craft: vi.fn(),
    saveFile: vi.fn(),
  },
}));
vi.mock("../src/api.js", () => ({ api: apiMock }));

const { MemoryPane } = await import("../src/workshop/MemoryPane.js");

/** 新剧目落盘的两个空文件（服务端 createEmpty 建的就是这两个）。 */
const FILES = [
  { path: "memory/always/craft.md", dir: ["memory", "always"], size: 0, writable: true, kind: "text" },
  { path: "memory/always/premise.md", dir: ["memory", "always"], size: 0, writable: true, kind: "text" },
  { path: "play.json", dir: [], size: 219, writable: true, kind: "text" },
  // 角色卡在顶层 characters/，不是记忆的一层，不该出现在这一页
  { path: "characters/protagonist.md", dir: ["characters"], size: 42, writable: true, kind: "text" },
];

/** 卡片标题与展开区 h3 同名，这里只认卡片（.setting-card 内的那一份）。 */
function cardTitles(): string[] {
  const cards = document.querySelectorAll(".setting-card");
  return [...cards].map((el) => el.querySelector(".setting-card-title")?.textContent ?? "");
}

/** 两份常驻设定同 rank，彼此先后不作数。 */
const EXPECTED = expect.arrayContaining(["世界与人物设定", "创作口径"]);

describe("记忆页：只收 memory/** 的卡", () => {
  beforeEach(() => {
    apiMock.readFile.mockResolvedValue({ path: "memory/always/premise.md", content: "" });
    apiMock.craft.mockResolvedValue({ content: "" });
    apiMock.saveFile.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("列出两份常驻设定，不列 play.json 与角色卡", async () => {
    apiMock.listFiles.mockResolvedValue(FILES);

    render(<MemoryPane playId="p1" revision={0} />);

    await waitFor(() => expect(cardTitles()).toEqual(EXPECTED));
    expect(cardTitles()).toHaveLength(2);
  });

  it("默认展开的是世界与人物设定，不是空态提示", async () => {
    apiMock.listFiles.mockResolvedValue(FILES);

    render(<MemoryPane playId="p1" revision={0} />);

    await waitFor(() => expect(cardTitles()).toHaveLength(2));
    expect(screen.queryByText("选一张设定卡开始读或改。")).toBeNull();
    expect(apiMock.readFile).toHaveBeenCalledWith("p1", "memory/always/premise.md");
  });

  it("读回来不算改过；敲一个字保存键才亮，点下去写回同一路径", async () => {
    apiMock.listFiles.mockResolvedValue(FILES);
    apiMock.readFile.mockResolvedValue({ path: "memory/always/premise.md", content: "旧设定" });

    render(<MemoryPane playId="p1" revision={0} />);

    const textarea = (await waitFor(() => {
      const el = document.querySelector("textarea.file-body") as HTMLTextAreaElement | null;
      expect(el?.value).toBe("旧设定");
      return el!;
    })) as HTMLTextAreaElement;
    const save = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: "旧设定，加一句" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(apiMock.saveFile).toHaveBeenCalledWith("p1", "memory/always/premise.md", "旧设定，加一句"));
  });
});
