// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayConfig } from "@aivn/core";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    playDetail: vi.fn(),
    listAssets: vi.fn(),
    savePlay: vi.fn(),
    saveFile: vi.fn(),
    deleteFile: vi.fn(),
    voiceCatalog: vi.fn(),
    voice: vi.fn(),
    ttsPreview: vi.fn(),
  },
}));
vi.mock("../src/api.js", () => ({ api: apiMock }));

const { CharacterPane } = await import("../src/workshop/CharacterPane.js");

const PLAY = {
  id: "p1",
  title: "新剧目",
  characters: [{ id: "mio", name: "play.json 里的旧名", persona: "play.json 里的旧人设" }],
  opening: "（游戏开始，请演出第一轮）",
  initialState: { turn: 0, affinity: {}, flags: {} },
  initialScene: "未定",
} as unknown as PlayConfig;

/** cast 是服务端解析好的整份角色卡（memory/always/characters/*.md），play.json 那份不参与。 */
const CAST = [
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
    apiMock.savePlay.mockResolvedValue({});
    apiMock.saveFile.mockResolvedValue({ ok: true });
    apiMock.deleteFile.mockResolvedValue({ ok: true });
    apiMock.voiceCatalog.mockResolvedValue({ entries: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("角色表就是 cast，play.json 那份纯元数据不参与", async () => {
    render(<CharacterPane playId="p1" revision={0} />);
    await waitFor(() => expect(cardTitles()).toContain("ミオ"));
    expect(cardTitles()).not.toContain("play.json 里的旧名");
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
    expect(path).toBe("memory/always/characters/mio.md");
    expect(content).toContain("name: ミオ");
    expect(content).toContain("framing: half");
    expect(content).toContain("neutral: mio_neutral.png");
    expect(content).toContain("改过的人设");
    expect(apiMock.savePlay).toHaveBeenCalledTimes(1);
  });

  it("移除角色就是删那张卡", async () => {
    render(<CharacterPane playId="p1" revision={0} />);
    await waitFor(() => expect(cardTitles()).toContain("ミオ"));
    fireEvent.click(screen.getByText("ミオ"));
    fireEvent.click(await screen.findByRole("button", { name: "移除角色" }));

    expect(apiMock.deleteFile).toHaveBeenCalledWith("p1", "memory/always/characters/mio.md");
    await waitFor(() => expect(cardTitles()).not.toContain("ミオ"));
  });

  it("新建角色只落角色卡，play.json 的 characters 不再被动", async () => {
    render(<CharacterPane playId="p1" revision={0} />);
    await waitFor(() => expect(cardTitles()).toContain("ミオ"));
    fireEvent.click(screen.getByRole("button", { name: /新建角色/ }));
    await screen.findByPlaceholderText("persona（性格与背景）");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(apiMock.savePlay).toHaveBeenCalled());
    const draft = apiMock.savePlay.mock.calls[0]![0] as PlayConfig;
    expect(draft.characters?.map((c) => c.id)).toEqual(["mio"]);
    // 卡本身照写：新角色落成 memory/always/characters/charN.md
    expect(apiMock.saveFile).toHaveBeenCalledWith(
      "p1",
      expect.stringMatching(/^memory\/always\/characters\/char\d+\.md$/),
      expect.stringContaining("name: 新角色"),
    );
  });
});