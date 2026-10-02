import { describe, expect, it } from "vitest";
import { PlayMemory } from "../src/memory.js";
import { LineageTree } from "@stage-ai/core";
import { agentToolCatalog, createAgentKit, defaultToolsFor, type AgentKit } from "../src/agentkit/kit.js";
import { ROLE_INSTALLABLE } from "../src/agentkit/role.js";
import type { PlaywriterKitDeps, WorkshopKitDeps } from "../src/agentkit/deps.js";

/**
 * 统一基座的契约：**同一份工具实现与 schema，两个角色都能用同一份清单**。
 * 这些断言是那次重构的真正交付物——哪天有人给某个角色单独加一份工具，这里必须红。
 */

/** 默认按角色的默认启用集装配；给了 enabled 就按它来（模拟用户在设置页勾过）。 */
function playwriter(over: Partial<PlaywriterKitDeps> = {}, enabled?: string[]): AgentKit {
  return createAgentKit({
    role: "playwriter",
    playId: "test",
    enabled: new Set(enabled ?? defaultToolsFor("playwriter")),
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
    existingAssetUrl: async () => null,
    // 资源库没配就不注册 list_library（装一个必然查不出东西的工具只会空转）
    assetLibrary: { list: async () => [] } as never,
    ...over,
  });
}

function workshop(over: Partial<WorkshopKitDeps> = {}, enabled?: string[]): AgentKit {
  return createAgentKit({
    role: "workshop",
    playId: "test",
    enabled: new Set(enabled ?? defaultToolsFor("workshop")),
    files: {} as never,
    store: {} as never,
    onWrite: () => {},
    onAsset: () => {},
    saves: {} as never,
    saveStore: () => ({}) as never,
    assetLibrary: { list: async () => [] } as never,
    voices: { get: async () => ({ entries: [] }) } as never,
    ...over,
  });
}

const names = (kit: AgentKit): string[] => kit.tools.map((t) => t.name).sort();

describe("agent kit：两个角色的暴露面", () => {
  it("剧作家拿轮收束与记忆，不拿剧目文件与故事树", () => {
    const kit = playwriter();
    expect(names(kit)).toEqual(["beat_done", "list_library", "read_memory_detail", "search_archive", "update_state", "write_memory"]);
    expect(names(kit)).not.toContain("write_file");
    expect(names(kit)).not.toContain("read_lineage");
    // 生图对剧作家默认关，勾上才装
    expect(names(playwriter())).not.toContain("generate_image");
    expect(names(playwriter({}, [...defaultToolsFor("playwriter"), "generate_image"]))).toContain("generate_image");
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

  it("generate_image 是同一个工具：schema 一模一样，只有描述与等待策略分叉", () => {
    const a = playwriter({}, [...defaultToolsFor("playwriter"), "generate_image"]).tools.find(
      (t) => t.name === "generate_image",
    )!;
    const b = workshop().tools.find((t) => t.name === "generate_image")!;
    // 垫图与差分两个角色都拿得到：参考立绘读的是 assets/sprites/，与谁调的无关
    const props = (t: typeof a) => Object.keys((t.parameters as { properties: Record<string, unknown> }).properties);
    for (const key of ["expression", "referenceCharacters"]) expect(props(a)).toContain(key);
    expect(a.parameters).toBe(b.parameters);
    expect(a.description).not.toBe(b.description);
    expect(b.description).toContain("recut_sprite"); // 工坊同步出图：抠底脏了原地重抠，不重新出图
    expect(a.description).toContain("后台排产");
    expect(b.description).toContain("referenceCharacters");
    expect(a.description).toContain("referenceCharacters");
  });

  it("写 prompt 的硬约束两个角色同一份（只写在工坊提示词里，等于剧作家那份没修）", () => {
    const rules = [
      "逐条带上角色卡的外貌",
      "垫图就是身份基准",
      "由引擎自动拼在 prompt 末尾",
      "姿势、机位、景别都要显式写",
    ];
    const withImage = playwriter({}, [...defaultToolsFor("playwriter"), "generate_image"]);
    for (const role of [() => withImage, workshop] as const) {
      const desc = role().tools.find((t) => t.name === "generate_image")!.description;
      for (const rule of rules) expect(desc).toContain(rule);
    }
    // 流程与验收仍各归各的：工坊管抠底重抠，剧作家管提前发起
    expect(workshop().tools.find((t) => t.name === "generate_image")!.description).toContain("recut_sprite");
    expect(withImage.tools.find((t) => t.name === "generate_image")!.description).toContain("提前 3–5 句发起");
  });

  it("没配 Exa 就不注册 web_search，配了才装（且两个角色同一份实现）", () => {
    const exa = { search: async () => [] } as never;
    expect(names(playwriter())).not.toContain("web_search");
    expect(names(playwriter({ exa }))).toContain("web_search");
    expect(names(workshop())).not.toContain("web_search");
    expect(names(workshop({ exa }))).toContain("web_search");
  });

  it("play.json 的启用集最后一道过滤：装出来再摘掉，能力位跟着翻", () => {
    const kit = workshop({}, ["read_skill"]);
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
      enabled: new Set(defaultToolsFor("workshop")),
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
  it("目录是两份角色合用的同一份全集，每条都有中文标签与分组", () => {
    const catalog = agentToolCatalog();
    expect(catalog.length).toBeGreaterThan(10);
    for (const entry of catalog) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.group.length).toBeGreaterThan(0);
      expect(entry.groupLabel.length).toBeGreaterThan(0);
    }
    // 目录里不该再有「这个工具归谁」的字段：归属由默认启用集表达
    expect(catalog[0]).not.toHaveProperty("roles");
  });

  it("剧作家默认不开生图、开只读查库；用户勾了就能开", () => {
    const playDefault = defaultToolsFor("playwriter");
    expect(playDefault).toContain("beat_done");
    expect(playDefault).not.toContain("generate_image");
    // 查库开着：宿主的引用即导入只认同名 id，看不见库里有什么就等于瞎猜
    expect(playDefault).toContain("list_library");
    expect(playDefault).not.toContain("import_asset");
    expect(playDefault).not.toContain("write_file");

    expect([...defaultToolsFor("workshop")].sort()).toEqual(agentToolCatalog("workshop").map((t) => t.id).sort());

    // 用户在设置页勾上：play.json 的启用集直接生效，不再有第二道代码默认
    const opened = playwriter({}, ["beat_done", "generate_image", "list_library"]);
    expect(names(opened)).toEqual(["beat_done", "generate_image", "list_library"]);
    expect(opened.can.image).toBe(true);
    expect(opened.can.library).toBe(true);
  });

  it("导入工具还在清单里，但剧作家默认拿不到（引用即导入才是它的默认路径）", () => {
    expect(agentToolCatalog().map((t) => t.id)).toContain("import_asset");
    expect(names(playwriter())).not.toContain("import_asset");
    expect(names(playwriter({}, [...defaultToolsFor("playwriter"), "import_asset"]))).toContain("import_asset");
  });

  it("设置页的目录必须等于工厂真实装出来的工具——否则卡上挂着一个勾了也没用的开关", () => {
    // 改依赖面时要改 role.ts 的 ROLE_INSTALLABLE 和 kit.ts 的角色工厂两处；这条是那两处之间的锁。
    // 按依赖都配齐来比：web_search 卡在 Exa key 上，资源库两个卡在库目录上，list_voices 卡在 TTS 上。
    const exa = { search: async () => [] } as never;
    expect(agentToolCatalog("playwriter").map((t) => t.id).sort()).toEqual(
      names(playwriter({ exa }, ROLE_INSTALLABLE.playwriter)).sort(),
    );
    expect(agentToolCatalog("workshop").map((t) => t.id).sort()).toEqual(
      names(workshop({ exa }, ROLE_INSTALLABLE.workshop)).sort(),
    );
  });

  it("beat_done 只列给剧作家：搭台那张卡上挂个勾了也没用的开关是骗人", () => {
    // 装配层早就分开了（workshopTools 里没有 createBeatDoneTool），漏的是设置页的目录
    expect(agentToolCatalog("playwriter").map((t) => t.id)).toContain("beat_done");
    expect(agentToolCatalog("workshop").map((t) => t.id)).not.toContain("beat_done");
    expect([...defaultToolsFor("workshop")]).not.toContain("beat_done");
    // 就算 play.json 里残留了旧的启用集，也装不上——过滤时匹配不到任何工具
    expect(names(workshop({}, [...defaultToolsFor("workshop"), "beat_done"]))).not.toContain("beat_done");
  });

  it("两个角色的资源库工具是同一份实现（剧作家只是没有对话流可挂撤销条）", () => {
    const a = playwriter({}, [...defaultToolsFor("playwriter"), "list_library", "import_asset"]);
    const b = workshop();
    for (const id of ["list_library", "import_asset"]) {
      const ta = a.tools.find((t) => t.name === id)!;
      const tb = b.tools.find((t) => t.name === id)!;
      expect(ta.parameters).toBe(tb.parameters);
      expect(ta.description).toBe(tb.description);
    }
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
