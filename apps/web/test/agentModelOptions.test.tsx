// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayConfig } from "@stage-ai/core";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    playDetail: vi.fn(),
    agentTools: vi.fn(),
    agentModels: vi.fn(),
    savePlay: vi.fn(),
  },
}));
vi.mock("../src/api.js", () => ({ api: apiMock }));

const { AgentPane } = await import("../src/workshop/AgentPane.js");

const PLAY = {
  id: "p1",
  title: "T",
  characters: [],
  opening: "（开始）",
  initialState: { turn: 0, affinity: {}, flags: {} },
  initialScene: "s",
} as unknown as PlayConfig;

/** 剧作家/搭台各一张卡，每张卡上「模型」是第一个下拉（后面紧跟思考档位）。 */
async function modelSelects(): Promise<HTMLSelectElement[]> {
  await waitFor(() => expect(screen.getAllByRole("combobox").length).toBe(4));
  const all = screen.getAllByRole("combobox") as HTMLSelectElement[];
  return [all[0]!, all[2]!];
}

describe("Agent 页模型下拉：play.json 里已有的模型不能因为清单收窄而消失", () => {
  beforeEach(() => {
    apiMock.playDetail.mockResolvedValue({ play: PLAY });
    apiMock.agentTools.mockResolvedValue({ tools: [], defaults: { playwriter: [], workshop: [] } });
    apiMock.agentModels.mockResolvedValue({
      models: [{ id: "low", name: "low" }],
      defaultModel: "medium",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("清单外的旧值仍显示在下拉里（否则 select 渲染成空白，看着像设置丢了）", async () => {
    apiMock.playDetail.mockResolvedValue({ play: { ...PLAY, agents: { playwriter: { model: "retired" } } } });
    render(<AgentPane playId="p1" />);

    const [playwriter] = await modelSelects();
    const options = [...playwriter.options].map((o) => o.textContent);
    expect(options).toContain("retired（不在支持清单里）");
    expect(playwriter.value).toBe("retired");
  });

  it("清单内的值照旧选中", async () => {
    apiMock.playDetail.mockResolvedValue({ play: { ...PLAY, agents: { playwriter: { model: "low" } } } });
    render(<AgentPane playId="p1" />);

    const [playwriter, workshop] = await modelSelects();
    expect(playwriter.value).toBe("low");
    // 没单独指定的那张卡 = 跟随服务端默认，不因为清单里只有一个模型就被钉死
    expect(workshop.value).toBe("");
    expect([...workshop.options].map((o) => o.textContent)).toEqual(["跟随服务端默认（medium）", "low"]);
  });
});