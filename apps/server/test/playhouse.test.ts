import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../src/config.js";
import { PlayLibrary } from "../src/store.js";
import { PlayHouse } from "../src/playhouse.js";

/** 关掉语音与生图：本用例只关心 runtime 装配，不碰任何外部服务。 */
function testConfig(playsRoot: string): ServerConfig {
  return {
    port: 0,
    playsRoot,
    modelId: "test-model",
    modelBase: "deepseek/deepseek-flash",
    baseUrl: "http://127.0.0.1:1",
    apiKey: "test-key",
    maxTokens: 32768,
    contextWindow: 131072,
    compactRatio: 0.75,
    keepRecentTokens: 12000,
    image: { enabled: false, model: "x", size: "1024x1024", concurrency: 1, timeoutMs: 1000 },
    tts: { enabled: false, keysPath: "", proxy: "", baseUrl: "", concurrency: 1 },
    exa: { enabled: false, keysPath: "", baseUrl: "", proxy: "", timeoutMs: 1000 },
  } as unknown as ServerConfig;
}

const PLAY_JSON = JSON.stringify({
  id: "test",
  title: "测试剧目",
  premise: "测试 premise",
  characters: [{ id: "mio", name: "澪", persona: "测试角色" }],
  opening: "（游戏开始）",
  initialState: { turn: 0, flags: {} },
  initialScene: "走廊",
});

describe("PlayHouse 首装去重", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stage-playhouse-"));
    await mkdir(join(root, "test"), { recursive: true });
    await writeFile(join(root, "test", "play.json"), PLAY_JSON);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // 首开一出戏时 WS 与浏览器拉的 /lineage 会同时进来。装配横跨多个 await，
  // 不去重就会各建一棵树、各建一份档：地图里存一棵没演过戏的空树，
  // 路线树与导演栏从此拿不到锚点，而磁盘上却有两份档。
  it("并发 get 共享同一个 runtime，只建一份档", async () => {
    const house = new PlayHouse(new PlayLibrary(root), testConfig(root));
    const [a, b] = await Promise.all([house.get("test"), house.get("test")]);

    expect(a).toBe(b);
    expect(await readdir(join(root, "test", "saves"))).toHaveLength(1);
  });

  it("装配完成后不再留住在飞记录", async () => {
    const house = new PlayHouse(new PlayLibrary(root), testConfig(root));
    const first = await house.get("test");
    expect(await house.get("test")).toBe(first);
  });
});
