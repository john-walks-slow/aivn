import { describe, expect, it } from "vitest";
import { PlayMemory } from "../src/memory.js";
import { LineageTree } from "@stage-ai/core";
import { agentToolCatalog, catalogFor, createAgentKit, type AgentKit } from "../src/agentkit/kit.js";
import type { PlaywriterKitDeps, WorkshopKitDeps } from "../src/agentkit/deps.js";

/**
 * 统一基座的契约：**同一份工具实现与 schema，两个角色仅仅是暴露不同**。
 * 这些断言是那次重构的真正交付物——哪天有人给某个角色单独加一份工具，这里必须红。
 */

function playwriter(over: Partial<PlaywriterKitDeps> = {}, disabled: string[] = []): AgentKit {
  return createAgentKit({
    role: "playwriter",
    playId: "test",
    disabled: new Set(disabled),
    engine: { turn: 0, affinity: {}, flags: {} },
    characterIds: new Set(["mio"]),
    memory: new PlayMemory(),
    tree: new LineageTree(),
    stateFiles: {},
    arcIds: () => [],
    emitStop: () => {},
    emitPreload: () => {},
    kick: () => {},
    kickSprite: () => {},
    statusOf: () => "none",
    hasStaticAsset: () => false,
    ...over,
  });
}

function workshop(over: Partial<WorkshopKitDeps> = {}, disabled: string[] = []): AgentKit {
  return createAgentKit({
    role: "workshop",
    playId: "test",
    disabled: new Set(disabled),
    files: {} as never,
    store: {} as never,
    onWrite: () => {},
    onAsset: () => {},
    saves: {} as never,
    saveStore: () => ({}) as never,
    ...over,
  });
}

const names = (kit: AgentKit): string[] => kit.tools.map((t) => t.name).sort();

describe("agent kit：两个角色的暴露面", () => {
  it("剧作家拿轮收束与记忆，不拿剧目文件与故事树", () => {
    const kit = playwriter();
    expect(names(kit)).toEqual(["beat_done", "generate_image", "read_memory_detail", "search_archive", "update_state", "write_memory"]);
    expect(names(kit)).not.toContain("write_file");
    expect(names(kit)).not.toContain("read_lineage");
  });

  it("工坊拿剧目文件、故事树与技能库，不拿轮收束与演出记忆", () => {
    const kit = workshop();
    expect(names(kit)).toContain("write_file");
    expect(names(kit)).toContain("edit_file");
    expect(names(kit)).toContain("read_lineage");
    expect(names(kit)).toContain("generate_image");
    expect(names(kit)).toContain("read_skill");
    expect(names(kit)).not.toContain("beat_done");
    expect(names(kit)).not.toContain("update_state");
  });

  it("generate_image 是同一个工具，只有描述分叉、schema 少一个 expression", () => {
    const a = playwriter().tools.find((t) => t.name === "generate_image")!;
    const b = workshop().tools.find((t) => t.name === "generate_image")!;
    // 差分只归工坊：剧作家那份 schema 拿不到 expression，其余参数逐字相同
    const props = (t: typeof a) => JSON.stringify((t.parameters as { properties: Record<string, unknown> }).properties);
    expect(props(a)).not.toContain("expression");
    expect(props(b)).toContain("expression");
    const { expression: _dropped, ...rest } = (b.parameters as { properties: Record<string, unknown> }).properties;
    expect(props(a)).toBe(JSON.stringify(rest));
    expect(a.description).not.toBe(b.description);
    expect(b.description).toContain("抠完觉得不干净"); // 工坊同步出图，教它看图重出
    expect(a.description).toContain("后台排产");
  });

  it("没配 Exa 就不注册 web_search，配了才装（且两个角色同一份实现）", () => {
    const exa = { search: async () => [] } as never;
    expect(names(playwriter())).not.toContain("web_search");
    expect(names(playwriter({ exa }))).toContain("web_search");
    expect(names(workshop())).not.toContain("web_search");
    expect(names(workshop({ exa }))).toContain("web_search");
  });

  it("disabledTools 最后一道过滤：装出来再摘掉，能力位跟着翻", () => {
    const kit = workshop({}, ["generate_image", "list_library"]);
    expect(names(kit)).not.toContain("generate_image");
    expect(kit.can.image).toBe(false);
    expect(kit.can.library).toBe(false);
    expect(kit.can.search).toBe(false);
    // 目录同步收窄：UI 的开关状态与实际装上的工具是同一份数据
    expect(kit.catalog.map((t) => t.id)).not.toContain("generate_image");
  });

  it("思考档位缺省 off，给了就透出", () => {
    expect(playwriter().thinking).toBe("off");
    expect(workshop().thinking).toBe("off");
    expect(workshop({}, []).thinking).toBe("off");
    const kit = createAgentKit({
      role: "workshop",
      playId: "test",
      disabled: new Set(),
      thinking: "high",
      files: {} as never,
      store: {} as never,
      onWrite: () => {},
      onAsset: () => {},
      saves: {} as never,
      saveStore: () => ({}) as never,
    });
    expect(kit.thinking).toBe("high");
  });
});

describe("agent kit：工具目录（设置页的数据源）", () => {
  it("每个工具都有中文标签与分组，且至少属于一个角色", () => {
    const catalog = agentToolCatalog();
    expect(catalog.length).toBeGreaterThan(10);
    for (const entry of catalog) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.group.length).toBeGreaterThan(0);
      expect(entry.roles.length).toBeGreaterThan(0);
    }
    expect(catalog.find((t) => t.id === "beat_done")?.roles).toEqual(["playwriter"]);
    expect(catalog.find((t) => t.id === "write_file")?.roles).toEqual(["workshop"]);
    expect(catalog.find((t) => t.id === "generate_image")?.roles).toEqual(["playwriter", "workshop"]);
  });

  it("目录按角色切分：两边并集就是全集，工坊看不到 beat_done", () => {
    const all = agentToolCatalog();
    const play = catalogFor("playwriter");
    const shop = catalogFor("workshop");
    expect(new Set([...play, ...shop].map((t) => t.id))).toEqual(new Set(all.map((t) => t.id)));
    expect(play.map((t) => t.id)).not.toContain("write_file");
    expect(shop.map((t) => t.id)).not.toContain("beat_done");
  });
});

describe("agent kit：剧作家工具真正动的是演出状态", () => {
  it("beat_done 把参数 emit 成停止点载荷（选项两条）", async () => {
    const stops: unknown[] = [];
    const kit = playwriter({ emitStop: (stop) => stops.push(stop) });
    const tool = kit.tools.find((t) => t.name === "beat_done")!;
    const result = await tool.execute("c1", { options: ["道歉", "装傻"] });
    expect(stops).toEqual([{ stopType: "choice", options: [{ text: "道歉" }, { text: "装傻" }] }]);
    // terminate 必须为真：丢了它假流会无限重跑同一批工具
    expect(result.terminate).toBe(true);
  });

  it("beat_done 的两种退化：只给 placeholder 停在自由输入，什么都不给就是自然演完", async () => {
    const stops: { stopType: string }[] = [];
    const kit = playwriter({ emitStop: (stop) => stops.push(stop) });
    const tool = kit.tools.find((t) => t.name === "beat_done")!;
    await tool.execute("c1", { placeholder: "想对他说什么？" });
    await tool.execute("c2", {});
    expect(stops).toEqual([{ stopType: "free", placeholder: "想对他说什么？" }]);
  });

  it("options 全是空白时报错让模型重写，不静默把这一轮变成没有停止点", async () => {
    const stops: unknown[] = [];
    const kit = playwriter({ emitStop: (stop) => stops.push(stop) });
    const tool = kit.tools.find((t) => t.name === "beat_done")!;
    // 逐条 trim 之后不足两条：schema 的 minItems 拦不住（每个元素 minLength=1 照样过）
    await expect(tool.execute("c1", { options: ["   ", "道歉"] })).rejects.toThrow(/两条非空文本/);
    expect(stops).toEqual([]);
  });

  it("options 与 placeholder 同时给：按 options 走，回执里说清 placeholder 不生效", async () => {
    const stops: { stopType: string }[] = [];
    const kit = playwriter({ emitStop: (stop) => stops.push(stop) });
    const tool = kit.tools.find((t) => t.name === "beat_done")!;
    const result = await tool.execute("c1", { options: ["道歉", "装傻"], placeholder: "想对他说什么？" });
    expect(stops).toEqual([{ stopType: "choice", options: [{ text: "道歉" }, { text: "装傻" }] }]);
    expect(result.content[0]?.text).toContain("placeholder 这轮不生效");
  });
});
