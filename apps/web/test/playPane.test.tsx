// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayConfig } from "@stage-ai/core";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    playDetail: vi.fn(),
    listAssets: vi.fn(),
    savePlay: vi.fn(),
    voiceCatalog: vi.fn(),
    voice: vi.fn(),
    ttsPreview: vi.fn(),
  },
}));
vi.mock("../src/api.js", () => ({
  api: apiMock,
  assetUrl: (playId: string, kind: string, id: string) => `/assets/${playId}/${kind}/${id}`,
}));

const { PlayPane } = await import("../src/workshop/PlayPane.js");

const PLAY = {
  id: "p1",
  title: "黄昏教室",
  opening: "（游戏开始，请演出第一轮）",
  initialScene: "旧校舍教室",
  defaultVoiceId: "voice-1",
  initialState: { turn: 0, affinity: {}, flags: {} },
} as unknown as PlayConfig;

describe("剧目页：只写 play.json 这份", () => {
  beforeEach(() => {
    apiMock.playDetail.mockResolvedValue({ play: { ...PLAY }, premise: "", readiness: {}, cast: [] });
    apiMock.listAssets.mockResolvedValue({ backgrounds: ["bg_a", "bg_b"], cg: ["cg_x"] });
    apiMock.savePlay.mockResolvedValue({ ok: true });
    apiMock.voiceCatalog.mockResolvedValue({ entries: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("摆的是剧目字段：标题 / opening / 语音语言 / 无名角色音色 / 封面", async () => {
    render(<PlayPane playId="p1" revision={0} />);

    const title = await screen.findByLabelText("标题");
    expect((title as HTMLInputElement).value).toBe("黄昏教室");
    expect(screen.getByLabelText(/opening/)).toBeTruthy();
    expect(screen.getByLabelText(/语音语言/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /换一个音色/ })).toBeTruthy();
    // 封面候选就是剧目已有的背景与插图
    expect(screen.getByTitle("bg_a")).toBeTruthy();
    expect(screen.getByTitle("cg_x")).toBeTruthy();
  });

  it("改标题、点一张封面后保存，落进 play.json 的同一份 draft", async () => {
    render(<PlayPane playId="p1" revision={0} />);
    fireEvent.change(await screen.findByLabelText("标题"), { target: { value: "新的标题" } });
    fireEvent.click(screen.getByTitle("bg_b"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(apiMock.savePlay).toHaveBeenCalledTimes(1));
    expect(apiMock.savePlay.mock.calls[0]![0]).toMatchObject({
      title: "新的标题",
      cover: { kind: "backgrounds", id: "bg_b" },
    });
  });

  it("「恢复自动挑选」把封面交还给自动挑的那张，而不是留一个空封面", async () => {
    render(<PlayPane playId="p1" revision={0} />);
    fireEvent.click(await screen.findByTitle("bg_a"));
    const clear = screen.getByRole("button", { name: "恢复自动挑选" });
    expect((clear as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(clear);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(apiMock.savePlay).toHaveBeenCalledTimes(1));
    expect(apiMock.savePlay.mock.calls[0]![0]).not.toHaveProperty("cover");
    expect((clear as HTMLButtonElement).disabled).toBe(true);
  });

  it("清空无名角色音色后再保存，play.json 里那个字段就没了", async () => {
    render(<PlayPane playId="p1" revision={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "清空" }));
    expect(screen.getByRole("button", { name: /挑一个音色/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(apiMock.savePlay).toHaveBeenCalledTimes(1));
    expect(apiMock.savePlay.mock.calls[0]![0]).not.toHaveProperty("defaultVoiceId");
  });

  it("这一页不碰角色卡与记忆：写口只有 savePlay", async () => {
    render(<PlayPane playId="p1" revision={0} />);
    fireEvent.change(await screen.findByLabelText("标题"), { target: { value: "改一下" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(apiMock.savePlay).toHaveBeenCalled());
    expect(apiMock.saveFile).toBeUndefined();
  });
});
