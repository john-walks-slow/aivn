// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../src/api.js";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    settings: vi.fn(),
    saveSettings: vi.fn(),
    agentModels: vi.fn(),
    openFirewall: vi.fn(),
  },
}));
vi.mock("../src/api.js", () => ({ api: apiMock }));
vi.mock("../src/router.jsx", () => ({ navigate: vi.fn() }));

const { SettingsScreen } = await import("../src/views/SettingsScreen.js");

/** 读视图（凭据已配好，只回掩码）——与服务端 SettingsApi.read() 同形。 */
function view(): Settings {
  return {
    bootstrap: { port: 8787, host: "127.0.0.1", dataRoot: "/data", lanUrls: [] },
    model: {
      modelId: "low",
      modelBase: "",
      models: "low",
      baseUrl: "https://gw.example/v1",
      apiKey: "sk-s••••1234",
      apiKeySet: true,
      maxTokens: 8192,
      contextWindow: 65536,
      compactRatio: 0.6,
      keepRecentTokens: 8000,
      nsfwModelId: "",
      nsfwPrompt: "",
    },
    workshopContext: { contextWindow: 65536, compactRatio: 0.6, keepRecentTokens: 8000 },
    beatTimeoutMs: 180000,
    password: "test••••word",
    passwordSet: true,
    lanAccess: false,
    image: {
      enabled: true,
      format: "gemini",
      baseUrl: "http://127.0.0.1:38000",
      apiKey: "flow••••9876",
      apiKeySet: true,
      model: "gemini-3.1-flash-image",
      size: "1K",
      concurrency: 2,
      timeoutMs: 240000,
      reference: "neutral",
    },
    tts: { enabled: false, proxy: "", baseUrl: "", concurrency: 2, keys: "", masked: [], keyCount: 0 },
    exa: { enabled: false, baseUrl: "", proxy: "", timeoutMs: 20000, keys: "", masked: [], keyCount: 0 },
  };
}

/** 点保存并交回提交给 PUT /api/config 的草稿。 */
async function saveDraft(): Promise<Record<string, any>> {
  fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
  await waitFor(() => expect(apiMock.saveSettings).toHaveBeenCalledTimes(1));
  return apiMock.saveSettings.mock.calls[0]![0] as Record<string, any>;
}

describe("设置页凭据：掩码回填，未触碰不误清", () => {
  beforeEach(() => {
    apiMock.settings.mockResolvedValue(view());
    apiMock.agentModels.mockResolvedValue({ models: [] });
    apiMock.saveSettings.mockImplementation(async () => ({ changed: [], settings: view() }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("已配好的凭据以掩码填进输入框，保存时原样回传（不是空串）", async () => {
    render(<SettingsScreen />);

    const modelKey = (await screen.findByLabelText(/API Key/)) as HTMLInputElement;
    const imageKey = screen.getByLabelText(/生图 Key/) as HTMLInputElement;
    const password = screen.getByLabelText(/访问密码/) as HTMLInputElement;
    expect(modelKey.value).toBe("sk-s••••1234");
    expect(imageKey.value).toBe("flow••••9876");
    expect(password.value).toBe("test••••word");

    const draft = await saveDraft();
    expect(draft.model.apiKey).toBe("sk-s••••1234");
    expect(draft.image.apiKey).toBe("flow••••9876");
    expect(draft.password).toBe("test••••word");
  });

  it("清空输入框 = 显式清除，保存回传空串", async () => {
    render(<SettingsScreen />);

    fireEvent.change(await screen.findByLabelText(/API Key/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/生图 Key/), { target: { value: "" } });

    const draft = await saveDraft();
    expect(draft.model.apiKey).toBe("");
    expect(draft.image.apiKey).toBe("");
  });
});
