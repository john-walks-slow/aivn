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
vi.mock("../src/router.jsx", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/router.jsx")>()),
  navigate: vi.fn(),
}));

const { SettingsScreen } = await import("../src/views/SettingsScreen.js");
const { settingsReturnFrom, settingsUrl } = await import("../src/router.jsx");

/** 读视图：这一组用例只关心导航与分组头，字段填最小可渲染的一份。 */
function view(): Settings {
  return {
    bootstrap: { port: 8787, host: "127.0.0.1", dataRoot: "/data", lanUrls: [] },
    model: {
      modelId: "low",
      modelBase: "",
      models: "low",
      baseUrl: "",
      apiKey: "",
      apiKeySet: false,
      maxTokens: 8192,
      contextWindow: 65536,
      compactRatio: 0.6,
      keepRecentTokens: 8000,
      nsfwModelId: "",
      nsfwPrompt: "",
    },
    workshopContext: { contextWindow: 65536, compactRatio: 0.6, keepRecentTokens: 8000 },
    beatTimeoutMs: 180000,
    password: "",
    passwordSet: false,
    lanAccess: false,
    image: {
      enabled: false,
      format: "gemini",
      baseUrl: "",
      apiKey: "",
      apiKeySet: false,
      model: "",
      size: "1K",
      concurrency: 1,
      timeoutMs: 240000,
      reference: "neutral",
      kinds: { background: {}, cg: {}, sprite: {} },
    },
    tts: { enabled: false, proxy: "", baseUrl: "", concurrency: 2, keys: "", masked: [], keyCount: 0 },
    exa: { enabled: false, baseUrl: "", proxy: "", timeoutMs: 20000, keys: "", masked: [], keyCount: 0 },
  };
}

/** jsdom 没有 matchMedia：按用例伪造一个「窄屏 / 宽屏」判定。 */
function stubMatchMedia(narrow: boolean): void {
  window.matchMedia = ((query: string) =>
    ({
      matches: narrow,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

/** 假装滚到某个位置：jsdom 里这些尺寸都是 0，先摆一份上去再发滚动事件。 */
function scrollTo(top: number): void {
  const body = document.querySelector(".settings-body") as HTMLElement;
  Object.defineProperty(body, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(body, "clientHeight", { value: 600, configurable: true });
  body.scrollTop = top;
  fireEvent.scroll(body);
}

/** 各组的文档位置（jsdom 里 rect 全是 0，几何判据没有输入）。 */
function stubSectionTops(tops: Record<string, number>): void {
  for (const [id, top] of Object.entries(tops)) {
    const el = document.querySelector(`#settings-${id}`) as HTMLElement;
    Object.defineProperty(el, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top }) as DOMRect,
    });
  }
}

describe("设置页的返回目标", () => {
  it("剧目标题页进来就回剧目标题页，不是首页", () => {
    const url = settingsUrl("/play/p1");
    expect(url).toBe("/settings?from=%2Fplay%2Fp1");
    expect(settingsReturnFrom(url.split("?")[1])).toBe("/play/p1");
  });

  it("没带 from（剧目库的「⚙ 设置」）回剧目库", () => {
    expect(settingsReturnFrom("")).toBe("/");
    expect(settingsReturnFrom(null)).toBe("/");
  });

  it("from 只认站内路径：别的串一律回剧目库", () => {
    expect(settingsReturnFrom("from=https%3A%2F%2Fevil.example")).toBe("/");
    expect(settingsReturnFrom("from=%2F%2Fevil.example")).toBe("/");
  });
});

const activeNav = (): string =>
  document.querySelector(".settings-nav-btn.is-active")?.textContent ?? "";

describe("设置页分组头：折叠开关只属于窄屏", () => {
  beforeEach(() => {
    apiMock.settings.mockResolvedValue(view());
    apiMock.agentModels.mockResolvedValue({ models: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("桌面：分组标题就是标题，不摆折叠开关（键盘也停不到按不动的按钮上）", async () => {
    stubMatchMedia(false);
    render(<SettingsScreen />);
    await screen.findByLabelText(/模型 ID/);
    expect(document.querySelectorAll(".settings-group-toggle")).toHaveLength(0);
    // 分组标题照旧在（只是不再是一个按钮）
    expect(document.querySelector(".settings-group h3")?.textContent).toBe("模型网关");
  });

  it("窄屏：分组标题是开关，点一下收起该组", async () => {
    stubMatchMedia(true);
    render(<SettingsScreen />);
    await screen.findByLabelText(/模型 ID/);
    // 命中的那次渲染要等 effect 回来一轮（首渲染按宽屏算）
    await waitFor(() =>
      expect(document.querySelector(".settings-group-toggle")).toBeTruthy(),
    );
    const toggle = document.querySelector(".settings-group-toggle") as HTMLElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-expanded")).toBe("false"));
    expect(toggle.closest(".settings-group")?.className).toContain("settings-group-collapsed");
  });

  it("滚动跟随：滚到底高亮最后一组，往回滚一屏就还给当前那组", async () => {
    stubMatchMedia(false);
    render(<SettingsScreen />);
    await screen.findByLabelText(/模型 ID/);
    expect(activeNav()).toBe("模型网关");

    scrollTo(1400); // 贴底
    await waitFor(() => expect(activeNav()).toBe("主题设置"));

    // 高亮带 = 滚动区上沿往下三成（600 × 0.3 = 180）：只有前四组的起点落在带里
    stubSectionTops({
      model: -900,
      workshop: -600,
      image: -200,
      music: 40,
      voice: 300,
      search: 560,
      access: 820,
      lan: 1080,
      appearance: 1340,
    });
    scrollTo(600);
    await waitFor(() => expect(activeNav()).toBe("音乐生成"));
  });
});
