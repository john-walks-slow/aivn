// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayConfig } from "@aivn/core";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    playDetail: vi.fn(),
    listAssets: vi.fn(),
    saveFile: vi.fn(),
    deleteFile: vi.fn(),
    voiceCatalog: vi.fn(),
    voice: vi.fn(),
    ttsPreview: vi.fn(),
  },
}));
vi.mock("../src/api.js", () => ({
  api: apiMock,
  // 缩略图要用它拼地址；不给出真实实现的话组件会在这里炸掉
  assetUrl: (playId: string, dir: string, name: string) => `/plays/${playId}/${dir}/${name}`,
}));

const { CharacterPane } = await import("../src/workshop/CharacterPane.js");

const PLAY = {
  id: "p1",
  title: "新剧目",
  characters: [{ id: "mio", name: "play.json 里的旧名", persona: "play.json 里的旧人设" }],
  opening: "（游戏开始，请演出第一轮）",
  initialState: { turn: 0, affinity: {}, flags: {} },
  initialScene: "未定",
} as unknown as PlayConfig;

/** cast 是服务端解析好的整份角色卡（characters/*.md），play.json 那份不参与。 */
const CAST = [
  { id: "protagonist", name: "你", body: "玩家扮演的角色。" },
  {
    id: "mio",
    name: "ミオ",
    framing: "half",
    sprites: { neutral: "mio_neutral.png" },
    body: "# ミオ\n角色卡里的人设。",
  },
];

function cardTitles(): string[] {
  return [...document.querySelectorAll(".setting-card")].map(
    (el) => el.querySelector(".setting-card-title")?.textContent ?? "",
  );
}

describe("角色页：真相源是角色卡", () => {
  beforeEach(() => {
    apiMock.playDetail.mockResolvedValue({ play: PLAY, premise: "", readiness: {}, cast: CAST });
    apiMock.listAssets.mockResolvedValue({});
    apiMock.saveFile.mockResolvedValue({ ok: true });
    apiMock.deleteFile.mockResolvedValue({ ok: true });
    apiMock.voiceCatalog.mockResolvedValue({ entries: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("角色表就是 cast（主角卡也在其中），play.json 那份纯元数据不参与", async () => {
    render(<CharacterPane playId="p1" revision={0} />);
    await waitFor(() => expect(cardTitles()).toContain("ミオ"));
    expect(cardTitles()).toContain("你");
    expect(cardTitles()).not.toContain("play.json 里的旧名");
    // 主角卡与角色卡同权：同一个编辑器、同一份正文
    expect(screen.getByText("玩家扮演")).toBeTruthy();
    // 角色卡的正文与头部一次到位，不必再逐个 readFile
    expect(apiMock.readFile).toBeUndefined();
  });

  it("编辑人设后随保存动作写成角色卡，没动过的卡一次都不写", async () => {
    render(<CharacterPane playId="p1" revision={0} />);
    await waitFor(() => expect(cardTitles()).toContain("ミオ"));
    fireEvent.click(screen.getByText("ミオ"));

    const textarea = await screen.findByPlaceholderText("persona（性格与背景）");
    // 人设就是卡片正文，原样带着那张卡的 markdown 标题
    expect((textarea as HTMLTextAreaElement).value).toBe("# ミオ\n角色卡里的人设。");
    fireEvent.change(textarea, { target: { value: "改过的人设" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(apiMock.saveFile).toHaveBeenCalledTimes(1));
    const [playId, path, content] = apiMock.saveFile.mock.calls[0] as [string, string, string];
    expect(playId).toBe("p1");
    expect(path).toBe("characters/mio.md");
    expect(content).toContain("name: ミオ");
    // 立绘取景与差分映射归素材表，卡上一个字节都不写（cast 里带上来的旧字段当噪声丢掉）
    expect(content).not.toContain("framing");
    expect(content).not.toContain("sprites");
    expect(content).toContain("改过的人设");
  });

  it("主角卡与角色卡同用一个编辑器，只是不给移除", async () => {
    render(<CharacterPane playId="p1" revision={0} />);
    await waitFor(() => expect(cardTitles()).toContain("你"));
    fireEvent.click(screen.getByText("你"));

    const textarea = await screen.findByPlaceholderText("persona（性格与背景）");
    expect((textarea as HTMLTextAreaElement).value).toBe("玩家扮演的角色。");
    // 主角能配立绘与音色（和别的角色一样），所以编辑器整份都在，唯独没有删除
    expect(screen.getByRole("button", { name: "从资源库导入" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "移除角色" })).toBeNull();

    fireEvent.change(textarea, { target: { value: "高二学生，话不多。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(apiMock.saveFile).toHaveBeenCalledTimes(1));
    expect(apiMock.saveFile.mock.calls[0]![1]).toBe("characters/protagonist.md");
  });

  it("移除角色就是删那张卡", async () => {
    render(<CharacterPane playId="p1" revision={0} />);
    await waitFor(() => expect(cardTitles()).toContain("ミオ"));
    fireEvent.click(screen.getByText("ミオ"));
    fireEvent.click(await screen.findByRole("button", { name: "移除角色" }));

    expect(apiMock.deleteFile).toHaveBeenCalledWith("p1", "characters/mio.md");
    await waitFor(() => expect(cardTitles()).not.toContain("ミオ"));
  });

  it("主角卡不在 cast 里（没迁移的老剧目）也要有入口，编辑后落在主角卡路径", async () => {
    apiMock.playDetail.mockResolvedValue({
      play: PLAY,
      premise: "",
      readiness: {},
      cast: CAST.filter((c) => c.id !== "protagonist"),
    });

    render(<CharacterPane playId="p1" revision={0} />);
    await waitFor(() => expect(cardTitles()).toContain("ミオ"));
    // 兜底补上的主角卡：名字回落成「你」，否则用户在这一页无处编辑、也无处导入
    expect(cardTitles()).toContain("你");

    fireEvent.click(screen.getByText("你"));
    const textarea = await screen.findByPlaceholderText("persona（性格与背景）");
    expect((textarea as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(textarea, { target: { value: "高二学生，话不多。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(apiMock.saveFile).toHaveBeenCalledTimes(1));
    expect(apiMock.saveFile.mock.calls[0]![1]).toBe("characters/protagonist.md");
  });

  it("新建角色指定 id，只落角色卡，play.json 不参与", async () => {
    render(<CharacterPane playId="p1" revision={0} />);
    await waitFor(() => expect(cardTitles()).toContain("ミオ"));
    fireEvent.click(screen.getByRole("button", { name: /新建角色/ }));
    fireEvent.change(screen.getByPlaceholderText("角色 id（字母数字_-）"), {
      target: { value: "rin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "建这个角色" }));
    await screen.findByPlaceholderText("persona（性格与背景）");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(apiMock.saveFile).toHaveBeenCalled());
    expect(apiMock.saveFile).toHaveBeenCalledWith(
      "p1",
      "characters/rin.md",
      expect.stringContaining("name: 新角色"),
    );
    // 这一页根本不碰 play.json
    expect(apiMock.savePlay).toBeUndefined();
  });

  it("新建角色拒绝非法与重名的 id，不落卡", async () => {
    render(<CharacterPane playId="p1" revision={0} />);
    await waitFor(() => expect(cardTitles()).toContain("ミオ"));
    fireEvent.click(screen.getByRole("button", { name: /新建角色/ }));
    const input = screen.getByPlaceholderText("角色 id（字母数字_-）");

    fireEvent.change(input, { target: { value: "有空格 的 id" } });
    fireEvent.click(screen.getByRole("button", { name: "建这个角色" }));
    expect(await screen.findByText("角色 id 仅允许字母数字与 _-")).toBeTruthy();

    fireEvent.change(input, { target: { value: "mio" } });
    fireEvent.click(screen.getByRole("button", { name: "建这个角色" }));
    expect(await screen.findByText("角色 id「mio」已被占用")).toBeTruthy();
    expect(cardTitles()).not.toContain("新角色");
  });
});

describe("角色页：立绘的那一眼", () => {
  beforeEach(() => {
    apiMock.playDetail.mockResolvedValue({ play: PLAY, premise: "", readiness: {}, cast: CAST });
    apiMock.saveFile.mockResolvedValue({ ok: true });
    apiMock.voiceCatalog.mockResolvedValue({ entries: [] });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("有立绘的角色拿立绘当缩略图（中立差分优先），没立绘的仍用图标", async () => {
    apiMock.listAssets.mockResolvedValue({
      "sprites/mio": ["smile.png", "neutral.png"],
      "sprites/other": ["a.png"],
    });
    const { container } = render(<CharacterPane playId="p1" revision={0} />);
    await waitFor(() => {
      const thumb = container.querySelector("img.setting-card-thumb");
      expect(thumb?.getAttribute("src")).toContain("sprites/mio/neutral.png");
    });
  });

  it("「管立绘」只在这一页给出入口，点击回的是那个角色的 id", async () => {
    apiMock.listAssets.mockResolvedValue({});
    const onManageSprites = vi.fn();
    render(<CharacterPane playId="p1" revision={0} onManageSprites={onManageSprites} />);
    await waitFor(() => expect(cardTitles()).toContain("ミオ"));
    fireEvent.click(screen.getByText("ミオ"));
    fireEvent.click(screen.getByText("打开立绘"));
    expect(onManageSprites).toHaveBeenCalledWith("mio");
  });
});
