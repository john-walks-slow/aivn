import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freshSettings, settingsFromEnv, type BootstrapConfig, type ServerConfig } from "../src/config.js";
import { mask, SettingsApi } from "../src/configApi.js";
import { lanAddresses } from "../src/startup.js";
import { settingsPath, SettingsStore } from "../src/settingsStore.js";

const BOOTSTRAP: BootstrapConfig = { port: 8787, host: "0.0.0.0", dataRoot: "/data" };

const opened: SettingsStore[] = [];

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
});

/** 起一个带内容的数据目录（走真实的 open → 读文件那条路）。 */
function fixture(initial?: ServerConfig): { api: SettingsApi; store: SettingsStore; root: string } {
  const root = mkdtempSync(join(tmpdir(), "stage-config-"));
  writeFileSync(
    settingsPath(root),
    JSON.stringify(
      initial ?? {
        ...freshSettings(),
        modelId: "low",
        apiKey: "sk-secret-value-1234",
        image: { ...freshSettings().image, enabled: true, apiKey: "flow-secret-9876" },
        tts: { ...freshSettings().tts, enabled: true, keys: ["fish-key-one", "fish-key-two"] },
        exa: { ...freshSettings().exa, enabled: true, keys: ["exa-key-one"] },
      },
    ),
    "utf8",
  );
  const store = SettingsStore.open(root, {});
  opened.push(store);
  return { api: new SettingsApi(store, BOOTSTRAP), store, root };
}

describe("设置面板的传输面", () => {
  it("读：凭据只回掩码，附存在位", () => {
    const { api } = fixture();
    const view = api.read();
    expect(view.model.apiKey).toBe("sk-s••••1234");
    expect(view.model.apiKeySet).toBe(true);
    expect(view.model.modelId).toBe("low");
    expect(view.tts.keyCount).toBe(2);
    expect(view.tts.masked).toEqual(["fish••••-one", "fish••••-two"]);
    // 明文永不出服务端：面板输入框恒空，留空即「保持不变」
    expect(view.tts.keys).toBe("");
    expect(JSON.stringify(view)).not.toContain("sk-secret-value-1234");
    expect(JSON.stringify(view)).not.toContain("fish-key-one");
  });

  it("读：启动期参数只读展示（端口/监听地址/数据目录）", () => {
    const bootstrap = fixture().api.read().bootstrap;
    expect(bootstrap.port).toBe(BOOTSTRAP.port);
    expect(bootstrap.host).toBe(BOOTSTRAP.host);
    expect(bootstrap.dataRoot).toBe(BOOTSTRAP.dataRoot);
    expect(Array.isArray(bootstrap.lanUrls)).toBe(true);
  });

  it("局域网访问：写完读回来一致、落盘也是它，监听地址与手机地址跟着它走", () => {
    const { api, store, root } = fixture();
    expect(api.read().lanAccess).toBe(false);
    expect(api.write({ lanAccess: true })).toEqual(["lanAccess"]);
    expect(api.read().lanAccess).toBe(true);
    expect(JSON.parse(readFileSync(settingsPath(root), "utf8")).lanAccess).toBe(true);
    // 值没变就不算改动
    expect(api.write({ lanAccess: true })).toEqual([]);

    // 没给显式 --host 时，实际监听地址与手机地址都由这个开关决定
    const auto = new SettingsApi(store, { ...BOOTSTRAP, host: undefined });
    expect(auto.read().bootstrap.host).toBe("0.0.0.0");
    expect(auto.read().bootstrap.lanUrls).toEqual(lanAddresses().map((ip) => `http://${ip}:${BOOTSTRAP.port}`));
    auto.write({ lanAccess: false });
    expect(auto.read().bootstrap.host).toBe("127.0.0.1");
    expect(auto.read().bootstrap.lanUrls).toEqual([]);
  });

  it("写：只改被改的字段，其余原样（落盘的就是内存那份）", () => {
    const { api, root } = fixture();
    const changed = api.write({ model: { modelId: "medium", maxTokens: 16384 } });
    expect(changed).toEqual(["modelId", "maxTokens"]);

    const saved = JSON.parse(readFileSync(settingsPath(root), "utf8"));
    expect(saved.modelId).toBe("medium");
    expect(saved.maxTokens).toBe(16384);
    expect(saved.apiKey).toBe("sk-secret-value-1234");
    expect(saved.image.apiKey).toBe("flow-secret-9876");
  });

  it("写：回传掩码 = 不改；清空 = 显式清除凭据", () => {
    const { api, root } = fixture();
    const read = (): string => JSON.parse(readFileSync(settingsPath(root), "utf8")).apiKey;

    expect(api.write({ model: { apiKey: "sk-s••••1234" } })).toEqual([]);
    expect(read()).toBe("sk-secret-value-1234");

    expect(api.write({ model: { apiKey: "sk-brand-new-key-9999" } })).toEqual(["apiKey"]);
    expect(read()).toBe("sk-brand-new-key-9999");

    expect(api.write({ model: { apiKey: "" } })).toEqual(["apiKey"]);
    expect(read()).toBe("");
  });

  it("写：值没变就不算改动，也不碰盘上那份", () => {
    const { api, root } = fixture();
    const before = readFileSync(settingsPath(root), "utf8");
    expect(api.write({ model: { modelId: "low" } })).toEqual([]);
    expect(readFileSync(settingsPath(root), "utf8")).toBe(before);
  });

  it("写：非法数值直接报错，不落半个文件", () => {
    const { api, root } = fixture();
    const before = readFileSync(settingsPath(root), "utf8");
    expect(() => api.write({ model: { maxTokens: 0 } })).toThrow(/正整数/);
    expect(() => api.write({ model: { compactRatio: 1.5 } })).toThrow(/0 到 1/);
    expect(readFileSync(settingsPath(root), "utf8")).toBe(before);
  });

  it("支持的模型清单：面板写什么就存什么，读回来是同一串", () => {
    const { api } = fixture();
    expect(api.write({ model: { models: "low, high" } })).toEqual(["models"]);
    expect(api.read().model.models).toBe("low, high");
    // 清空 = 回到「不限制」，也是一个真改动
    expect(api.write({ model: { models: "" } })).toEqual(["models"]);
    expect(api.read().model.models).toBe("");
  });

  it("多把 key：留空 = 不改，填入 = 整组替换", () => {
    const { api, root } = fixture();
    const keys = (): string[] => JSON.parse(readFileSync(settingsPath(root), "utf8")).tts.keys;

    // 面板回传的空串（输入框没动）不该擦掉已存的 key
    expect(api.write({ tts: { keys: "" } })).toEqual([]);
    expect(api.write({ tts: { keys: "   " } })).toEqual([]);
    expect(keys()).toEqual(["fish-key-one", "fish-key-two"]);

    expect(api.write({ tts: { keys: "new-1, new-2 , new-3" } })).toEqual(["tts.keys"]);
    expect(keys()).toEqual(["new-1", "new-2", "new-3"]);
    expect(api.read().tts.keyCount).toBe(3);
  });

  it("联网检索面与语音面同构：开关/端点/超时/密钥都可改", () => {
    const { api } = fixture();
    expect(api.read().exa.keyCount).toBe(1);
    expect(api.read().exa.masked).toEqual(["exa-••••-one"]);

    expect(api.write({ exa: { enabled: false, timeoutMs: 30000, keys: "e1,e2" } })).toEqual([
      "exa.enabled",
      "exa.keys",
      "exa.timeoutMs",
    ]);
    const view = api.read();
    expect(view.exa.enabled).toBe(false);
    expect(view.exa.timeoutMs).toBe(30000);
    expect(view.exa.keyCount).toBe(2);
  });

  it("工坊压缩参数与单轮超时也在面板里（工坊能换窗口不同的模型）", () => {
    const { api } = fixture();
    expect(api.write({ workshopContext: { contextWindow: 131072 }, beatTimeoutMs: 300000 })).toEqual([
      "beatTimeoutMs",
      "workshopContext",
    ]);
    expect(api.read().workshopContext.contextWindow).toBe(131072);
    expect(api.read().beatTimeoutMs).toBe(300000);
  });

  it("访问密码同凭据一套语义：掩码不改、清空 = 关闭设防", () => {
    const { api } = fixture({ ...freshSettings(), password: "test-password" });
    expect(api.read().password).toBe("test••••word");
    expect(api.read().passwordSet).toBe(true);

    expect(api.write({ password: "test••••word" })).toEqual([]);
    expect(api.write({ password: "new-secret-pw" })).toEqual(["password"]);
    expect(api.write({ password: "" })).toEqual(["password"]);
    expect(api.read().passwordSet).toBe(false);
  });

  it("生图面：格式 / 地址 / 档位读写同构，凭据只回掩码；档位写回时归一化成官方大写", () => {
    const { api } = fixture();
    const view = api.read();
    expect(view.image.enabled).toBe(true);
    expect(view.image.apiKey).toBe("flow••••9876");
    expect(JSON.stringify(view)).not.toContain("flow-secret-9876");

    expect(api.write({ image: { apiKey: view.image.apiKey } })).toEqual([]);
    expect(api.write({ image: { size: "4k" } })).toEqual(["image.size"]);
    expect(api.read().image.size).toBe("4K");
    expect(api.write({ image: { size: "1536x1024" } })).toEqual(["image.size"]);
    expect(api.read().image.size).toBe("1536x1024");
    expect(() => api.write({ image: { size: "huge" } })).toThrow(/生图尺寸「huge」非法/);
    expect(api.write({ image: { format: "openai" } })).toEqual(["image.format"]);
    expect(api.write({ image: { apiKey: "brand-new-image-key" } })).toEqual(["image.apiKey"]);
    expect(JSON.stringify(api.read())).not.toContain("brand-new-image-key");
    expect(api.read().image.apiKeySet).toBe(true);
  });

  it("迁移过来的旧配置在面板上照原样显示（生图/语音/联网开着的还是开着）", () => {
    const { api } = fixture(settingsFromEnv({ STAGE_MODEL_ID: "ms/x", STAGE_TTS_KEYS: "k1,k2" }));
    const view = api.read();
    expect(view.model.modelId).toBe("ms/x");
    expect(view.image.enabled).toBe(true);
    expect(view.tts.keyCount).toBe(2);
  });

  it("掩码：短密钥不露头尾，空值为空串", () => {
    expect(mask("abcdefghijklmnop")).toBe("abcd••••mnop");
    expect(mask("short")).toBe("••••");
    expect(mask("")).toBe("");
  });
});
