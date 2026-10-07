import { describe, expect, it, vi } from "vitest";
import {
  applyPatch,
  freshSettings,
  imagePendingTtlMs,
  loadBootstrap,
  parseKeyList,
  parseModelList,
  settingsFromEnv,
} from "../src/config.js";
import { resolveHost } from "../src/lanAccess.js";

describe("启动期参数（只有它认环境变量）", () => {
  it("默认：8787、监听地址交给设置页的「局域网访问」决定、数据目录用调用方给的兜底值", () => {
    const boot = loadBootstrap({}, "/repo");
    expect(boot.port).toBe(8787);
    expect(boot.host).toBeUndefined();
    expect(boot.dataRoot).toBe("/repo");
  });

  it("端口 / 监听地址 / 数据目录都能用环境变量改（打包后是 exe 旁边的 .env）", () => {
    const boot = loadBootstrap(
      { STAGE_PORT: "9000", STAGE_HOST: "127.0.0.1", STAGE_DATA_DIR: "/data/stage" },
      "/repo",
    );
    expect(boot).toEqual({ port: 9000, host: "127.0.0.1", dataRoot: "/data/stage" });
  });

  it("端口非法回退默认并告警（0 会让监听落在一个随机端口上）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadBootstrap({ STAGE_PORT: "0" }, "/repo").port).toBe(8787);
    expect(loadBootstrap({ STAGE_PORT: "abc" }, "/repo").port).toBe(8787);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("命令行参数压过环境变量（双击 exe 的人改不了环境变量，但能带参数）", () => {
    const boot = loadBootstrap(
      { STAGE_PORT: "9000", STAGE_HOST: "127.0.0.1", STAGE_DATA_DIR: "/data/stage" },
      "/repo",
      { port: 8123, dataRoot: "/data/other" },
    );
    expect(boot).toEqual({ port: 8123, host: "127.0.0.1", dataRoot: "/data/other" });
  });
});

describe("监听地址的三态（显式覆盖 > 局域网访问开关）", () => {
  it("显式给了 --host / STAGE_HOST 就是它，开关管不着", () => {
    expect(resolveHost("192.168.1.5", false)).toBe("192.168.1.5");
    expect(resolveHost("192.168.1.5", true)).toBe("192.168.1.5");
    expect(loadBootstrap({ STAGE_HOST: "10.0.0.2" }, "/repo").host).toBe("10.0.0.2");
  });

  it("没给显式地址时看开关：开着听所有网卡，关着只听本机", () => {
    expect(resolveHost(undefined, true)).toBe("0.0.0.0");
    expect(resolveHost(undefined, false)).toBe("127.0.0.1");
    // 空白串按「没给」算，别把一个空 host 递给 listen
    expect(resolveHost("   ", true)).toBe("0.0.0.0");
  });
});

describe("新装默认值", () => {
  it("网关留空、生图/语音/联网/局域网访问默认关（什么都不配也能打开界面）", () => {
    const config = freshSettings();
    expect(config.baseUrl).toBe("");
    expect(config.apiKey).toBe("");
    expect(config.modelId).toBe("");
    expect(config.password).toBe("");
    expect(config.lanAccess).toBe(false);
    expect(config.image.enabled).toBe(false);
    expect(config.tts.enabled).toBe(false);
    expect(config.exa.enabled).toBe(false);
  });

  it("默认窗口/阈值/保留预算，工坊逐项沿用全局", () => {
    const config = freshSettings();
    expect(config.contextWindow).toBe(262144);
    expect(config.compactRatio).toBe(0.6);
    expect(config.keepRecentTokens).toBe(20000);
    expect(config.workshopContext).toEqual({
      contextWindow: 262144,
      compactRatio: 0.6,
      keepRecentTokens: 20000,
    });
  });
});

describe("旧 .env 的迁移语义", () => {
  it("生图/语音/联网默认开、指向本机网关", () => {
    const config = settingsFromEnv({});
    expect(config.baseUrl).toBe("http://127.0.0.1:9999/v1");
    expect(config.apiKey).toBe("sk-1234");
    expect(config.image.enabled).toBe(true);
    expect(config.image.baseUrl).toBe("http://127.0.0.1:9999");
    expect(config.image.format).toBe("gemini");
    expect(config.image.model).toBe("gemini-3.0-pro-image");
    expect(config.tts.enabled).toBe(true);
    expect(config.tts.proxy).toBe("");
    expect(config.exa.enabled).toBe(true);
    expect(config.exa.baseUrl).toBe("https://api.exa.ai");
  });

  it("工坊三项各自覆盖全局（工坊能换窗口不同的模型）", () => {
    const config = settingsFromEnv({
      STAGE_CONTEXT_WINDOW: "262144",
      STAGE_WORKSHOP_CONTEXT_WINDOW: "131072",
      STAGE_WORKSHOP_KEEP_RECENT_TOKENS: "8000",
    });
    expect(config.contextWindow).toBe(262144);
    expect(config.workshopContext.contextWindow).toBe(131072);
    expect(config.workshopContext.keepRecentTokens).toBe(8000);
    // 没写的那项仍回落全局
    expect(config.workshopContext.compactRatio).toBe(config.compactRatio);
  });

  it("非法值回退默认并告警（越界比例会让压缩永不触发或每轮都触发）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(settingsFromEnv({ STAGE_COMPACT_RATIO: "3" }).compactRatio).toBe(0.6);
    expect(settingsFromEnv({ STAGE_COMPACT_RATIO: "0" }).compactRatio).toBe(0.6);
    expect(settingsFromEnv({ STAGE_CONTEXT_WINDOW: "abc" }).contextWindow).toBe(262144);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("多把 key 逗号/空白分隔读入，保序去重（轮询顺序就是配置里写的顺序）", () => {
    expect(parseKeyList(undefined)).toEqual([]);
    expect(parseKeyList("   ")).toEqual([]);
    expect(parseKeyList("k1, k2 , k3")).toEqual(["k1", "k2", "k3"]);
    expect(parseKeyList("k2, k1, k2")).toEqual(["k2", "k1"]);
    expect(settingsFromEnv({ STAGE_TTS_KEYS: "sk-a,sk-b" }).tts.keys).toEqual(["sk-a", "sk-b"]);
  });

  it("STAGE_MODELS：逗号与空白都算分隔，保序去重", () => {
    expect(parseModelList(undefined)).toEqual([]);
    expect(parseModelList("   ")).toEqual([]);
    expect(parseModelList("low, high\tvision\nmedium")).toEqual(["low", "high", "vision", "medium"]);
    expect(settingsFromEnv({ STAGE_MODELS: "low, low ,high" }).models).toEqual(["low", "high"]);
  });
});

describe("设置补丁（设置页保存的那条路）", () => {
  it("只返回真的变了的字段", () => {
    const base = freshSettings();
    expect(applyPatch(base, {}).changed).toEqual([]);
    expect(applyPatch(base, { modelId: "" }).changed).toEqual([]);
    expect(applyPatch(base, { modelId: "low" }).changed).toEqual(["modelId"]);
    expect(applyPatch(base, { image: { enabled: true, concurrency: 6 } }).changed).toEqual(["image.enabled"]);
  });

  it("嵌套块只改给到的项，其余原样", () => {
    const base = settingsFromEnv({});
    const { next, changed } = applyPatch(base, { tts: { concurrency: 4 } });
    expect(changed).toEqual(["tts.concurrency"]);
    expect(next.tts.concurrency).toBe(4);
    expect(next.tts.keys).toEqual(base.tts.keys);
    expect(next.image).toEqual(base.image);
  });

  it("非法数值直接抛错（写进去的值上游读不懂，比报错更难查）", () => {
    const base = freshSettings();
    expect(() => applyPatch(base, { maxTokens: 0 })).toThrow(/正整数/);
    expect(() => applyPatch(base, { compactRatio: 1.5 })).toThrow(/0 到 1/);
    expect(() => applyPatch(base, { image: { size: "huge" } })).toThrow(/生图尺寸/);
    expect(() => applyPatch(base, { image: { format: "png" as never } })).toThrow(/生图接口格式/);
    expect(() => applyPatch(base, { modelBase: "deepseek-flash" })).toThrow(/provider\/modelId/);
  });

  it("局域网访问按布尔收：手写 settings.json 里给了非布尔值按关处理", () => {
    const on = applyPatch(freshSettings(), { lanAccess: true });
    expect(on.changed).toEqual(["lanAccess"]);
    expect(on.next.lanAccess).toBe(true);
    expect(applyPatch(freshSettings(), { lanAccess: "yes" as never }).next.lanAccess).toBe(false);
  });

  it("生图档位写回时归一化成官方大写（K 写成小写官方直接拒）", () => {
    const { next } = applyPatch(freshSettings(), { image: { size: "1k" } });
    expect(next.image.size).toBe("1K");
    expect(applyPatch(freshSettings(), { image: { size: "1536x1024" } }).next.image.size).toBe("1536x1024");
  });

  it("保留预算 ≥ 触发阈值：告警（否则每轮判超标却永远切不出可压段）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    applyPatch(freshSettings(), { keepRecentTokens: 200000 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("纪元压缩将无法切出可压段"));
    warn.mockRestore();
  });
});

describe("骨架兜底上界", () => {
  it("覆盖「自己超时 + 排队等到自己」最坏情况，且随生图配置缩放", () => {
    const base = freshSettings().image;
    // 默认 180s 超时、并发 6、队列 12 → 自己一次 + 排在两批后面 = 540s
    expect(imagePendingTtlMs(base)).toBe(540_000);

    // 超时变长、并发变小 → 上界跟着变长（写死 45s 时这两条都无从谈起）
    expect(imagePendingTtlMs({ ...base, timeoutMs: 60_000 })).toBe(180_000);
    expect(imagePendingTtlMs({ ...base, concurrency: 12 })).toBe(360_000);
  });
});
