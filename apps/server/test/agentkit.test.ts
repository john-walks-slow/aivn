import { describe, expect, it } from "vitest";
import { PlayMemory } from "../src/memory.js";
import { LineageTree } from "@aivn/core";
import {
  BASE_TOOLS,
  CAPABILITY_CATALOG,
  capabilityCatalog,
  capabilityTools,
  createAgentKit,
  defaultCapabilitiesFor,
  enabledCapabilitiesFor,
  enabledToolsFor,
  installableTools,
  roleTools,
  writeScopesFor,
  type AgentKit,
  type CapabilityEnv,
} from "../src/agentkit/kit.js";
import {
  CAPABILITY_MATRIX,
  TOOL_SIDE_EFFECT_CATALOG,
  assertToolContracts,
  sideEffectsForTool,
} from "../src/agentkit/contract.js";
import { PlayFiles } from "../src/playFiles.js";
import { AGENT_ROLES } from "../src/agentkit/role.js";
import type { AgentKitDeps, PlaywriterKitDeps, WorkshopKitDeps } from "../src/agentkit/deps.js";

/**
 * 统一基座的契约：**同一份工具实现与 schema，两个角色共用一套装配**，用户语汇只有能力。
 * 这些断言是那次重构的真正交付物——哪天有人给某个角色单独加一份工具、或新增工具忘了挂能力，
 * 这里必须红。
 */

/** 剧作家的依赖面（capabilities 留空：要比的是工厂的原样产物时用得上）。 */
function playwriterDeps(over: Partial<PlaywriterKitDeps> = {}): PlaywriterKitDeps {
  return {
    role: "playwriter",
    playId: "test",
    capabilities: new Set<string>(),
    engine: { turn: 0, affinity: {}, flags: {} },
    characterIds: new Set(["mio"]),
    memory: new PlayMemory(),
    tree: new LineageTree(),
    stateFiles: {},
    // 文件工具的白名单根：只有 store.dir 参与，构造时不碰盘
    files: new PlayFiles({ dir: "/tmp/stage-agentkit-test" } as never),
    onWrite: () => {},
    emitStop: () => {},
    emitPreload: () => {},
    kick: () => {},
    kickSprite: () => {},
    existingAssetUrl: async () => null,
    onEnterNsfw: () => {},
    onExitNsfw: () => {},
    isNsfw: () => false,
    // 资源库没配就不注册 list_library（装一个必然查不出东西的工具只会空转）
    assetLibrary: { list: async () => [] } as never,
    ...over,
  };
}

function workshopDeps(over: Partial<WorkshopKitDeps> = {}): WorkshopKitDeps {
  return {
    role: "workshop",
    playId: "test",
    capabilities: new Set<string>(),
    files: {} as never,
    store: {} as never,
    onWrite: () => {},
    onAsset: () => {},
    saves: {} as never,
    saveStore: () => ({}) as never,
    assetLibrary: { list: async () => [] } as never,
    voices: { get: async () => ({ entries: [] }) } as never,
    // 音乐生成层：没配后端就不注册 generate_bgm（与 image / exa 同一套「配齐才装得上」）
    playMusic: { existingUrl: async () => null } as never,
    ...over,
  };
}

/** 默认按角色的默认启用集装配；给了 caps 就按它来（模拟用户在设置页勾过）。 */
function playwriter(over: Partial<PlaywriterKitDeps> = {}, caps?: string[]): AgentKit {
  return createAgentKit({
    ...playwriterDeps(over),
    capabilities: new Set(caps ?? defaultCapabilitiesFor("playwriter")),
  });
}

function workshop(over: Partial<WorkshopKitDeps> = {}, caps?: string[]): AgentKit {
  return createAgentKit({
    ...workshopDeps(over),
    capabilities: new Set(caps ?? defaultCapabilitiesFor("workshop")),
  });
}

/** 工厂的原样产物（没过能力启用集那道过滤）。 */
function roleToolNames(deps: AgentKitDeps): string[] {
  return roleTools(deps).map((t) => t.name).sort();
}

const names = (kit: AgentKit): string[] => kit.tools.map((t) => t.name).sort();

/** 服务端配置齐全时的能力目录（「暂不生效」那一路单独测）。 */
const FULL_ENV: CapabilityEnv = { search: true, voice: true, image: true, music: true };

/** 工具层的全集：把每个角色的可装清单并起来就是目录本身。 */
const allToolIds = (): string[] => [...new Set(AGENT_ROLES.flatMap((role) => installableTools(role)))].sort();

describe("agent kit：跨宿主能力与副作用契约", () => {
  it("矩阵覆盖每个能力目录项，并记录两宿主实现与依赖", () => {
    const matrix = new Map(CAPABILITY_MATRIX.map((entry) => [entry.id, entry]));
    for (const capability of CAPABILITY_CATALOG) {
      const entry = matrix.get(capability.id);
      expect(entry, `能力 ${capability.id} 没有跨宿主矩阵记录`).toBeDefined();
      expect(entry!.hosts.stageAi.length).toBeGreaterThan(0);
      expect(entry!.hosts.dshAivn.length).toBeGreaterThan(0);
      expect(entry!.hosts.backendDependency.length).toBeGreaterThan(0);
      expect(entry!.hosts.intentionalDifference.length).toBeGreaterThan(0);
      expect(entry!.roles).toEqual(expect.arrayContaining(capability.roles));
    }
    expect(matrix.size).toBe(CAPABILITY_CATALOG.length);
  });

  it("所有实际工具都有九项副作用元数据，且关键生命周期声明明确", () => {
    const exa = { search: async () => [] } as never;
    const deps = { playwriter: playwriterDeps({ exa }), workshop: workshopDeps({ exa }) };
    const tools = AGENT_ROLES.flatMap((role) => roleTools(deps[role]));
    assertToolContracts(tools.map((tool) => ({ name: tool.name, sideEffects: TOOL_SIDE_EFFECT_CATALOG[tool.name] })));
    for (const role of AGENT_ROLES) {
      const kit = role === "playwriter" ? playwriter({ exa }) : workshop({ exa });
      assertToolContracts(kit.tools);
    }
    expect(sideEffectsForTool("generate_image", "playwriter")).toMatchObject({
      external_request: true,
      asset_create: true,
      asset_adopt: true,
      background_job: true,
      // 剧作家一次调用就把图落进 assets/（draft + commit 一次做完），所以它确实写工作区；
      // 工坊形态只落草稿，这一位必须是假——两者写法不同正是这个字段要表达的东西。
      workspace_write: true,
    });
    expect(sideEffectsForTool("generate_image", "workshop")).toMatchObject({
      external_request: true,
      asset_create: true,
      asset_adopt: false,
      background_job: false,
      workspace_write: false,
    });
    expect(sideEffectsForTool("commit_asset")).toMatchObject({
      workspace_write: true,
      asset_adopt: true,
      requires_confirmation: true,
      reversible: false,
      idempotent: true,
    });
    expect(sideEffectsForTool("generate_bgm")).toMatchObject({
      external_request: true,
      asset_create: true,
      background_job: true,
    });
  });

  it("契约校验拒绝缺失或非布尔副作用字段", () => {
    expect(() => assertToolContracts([{ name: "missing" }])).toThrow(/no side-effect contract/);
    expect(() =>
      assertToolContracts([{ name: "broken", sideEffects: { ...TOOL_SIDE_EFFECT_CATALOG.read, read_only: "yes" as never } }]),
    ).toThrow(/invalid side-effect field read_only/);
  });
  it("剧作家拿轮收束、记忆与剧目文件，不拿命令行与故事树", () => {
    const kit = playwriter();
    expect(names(kit)).toEqual([
      "beat_done",
      "edit",
      "enter_nsfw",
      "exit_nsfw",
      "generate_image",
      "list_library",
      "read",
      "read_memory_detail",
      "search_archive",
      "update_state",
      "write",
    ]);
    // 角色卡与记忆卡都是普通剧目文件，没有第二个写口（create_character / write_memory 已收掉）
    expect(names(kit)).not.toContain("create_character");
    expect(names(kit)).not.toContain("write_memory");
    expect(names(kit)).not.toContain("bash");
    expect(names(kit)).not.toContain("read_lineage");
    // 用户在 Agent 页关掉生图，下一轮就装不进去（策略随之失效）
    expect(names(playwriter({}, defaultCapabilitiesFor("playwriter").filter((id) => id !== "image")))).not.toContain(
      "generate_image",
    );
  });

  it("工坊拿剧目文件、故事树与技能库，不拿轮收束与演出记忆", () => {
    const kit = workshop();
    // read / write / edit 是 pi 的内建工具，两个角色同一套，白名单在 PlayEnv 里收口
    expect(names(kit)).toContain("read");
    expect(names(kit)).toContain("write");
    expect(names(kit)).toContain("edit");
    expect(names(kit)).toContain("read_lineage");
    expect(names(kit)).toContain("generate_image");
    expect(names(kit)).toContain("read_skill");
    expect(names(kit)).not.toContain("beat_done");
    expect(names(kit)).not.toContain("update_state");
    // bash 默认关：它以服务进程的权限跑，不是随手开的东西
    expect(names(kit)).not.toContain("bash");
    expect(kit.can.shell).toBe(false);
  });

  it("generate_image 是同一个工具：schema 一模一样，只有描述与等待策略分叉", () => {
    const a = playwriter().tools.find((t) => t.name === "generate_image")!;
    const b = workshop().tools.find((t) => t.name === "generate_image")!;
    // 垫图与差分两个角色都拿得到：参考立绘读的是 assets/sprites/，与谁调的无关
    const props = (t: typeof a) => Object.keys((t.parameters as { properties: Record<string, unknown> }).properties);
    for (const key of ["variant", "spriteId", "references"]) expect(props(a)).toContain(key);
    expect(a.parameters).toBe(b.parameters);
    expect(a.description).not.toBe(b.description);
    expect(b.description).toContain("recut_sprite"); // 工坊同步出图：抠底脏了原地重抠，不重新出图
    expect(a.description).toContain("后台排产");
    expect(b.description).toContain("referenceCharacters");
    expect(a.description).toContain("referenceCharacters");
  });

  it("模型看得见的说明写在 schema 的 description 里，不是只写在 JSDoc 注释里", () => {
    // 这条是检视 S5 的固化：`title` 与 `spriteId` 的说明曾经只写在 JSDoc 注释里，
    // 而 parameters 是运行时 TypeBox 对象——注释不进模型可见的 JSON schema，
    // 于是「机制归 DESCRIPTION」在语义上成立、在事实上落空。
    const tool = playwriter().tools.find((t) => t.name === "generate_image")!;
    const props = (tool.parameters as { properties: Record<string, { description?: string }> }).properties;
    for (const key of ["title", "spriteId", "variant", "prompt"]) {
      expect(props[key]?.description, `${key} 没有模型可见的 description`).toBeTruthy();
    }
    // 两条最容易丢的语义，逐字钉住
    expect(props.title!.description).toContain("没有角色卡的主体必须给");
    expect(props.spriteId!.description).toContain("sprite:");
  });

  it("写 prompt 的硬约束两个角色同一份（只写在工坊提示词里，等于剧作家那份没修）", () => {
    const rules = [
      "逐条带上角色卡的外貌",
      "垫图就是身份基准",
      "由引擎自动拼在 prompt 末尾",
      "姿势、机位、景别都要显式写",
    ];
    const withImage = playwriter();
    for (const role of [() => withImage, workshop] as const) {
      const desc = role().tools.find((t) => t.name === "generate_image")!.description;
      for (const rule of rules) expect(desc).toContain(rule);
    }
    // 流程与验收仍各归各的：工坊管抠底重抠，剧作家多一句「图还没到时先上骨架」
    expect(workshop().tools.find((t) => t.name === "generate_image")!.description).toContain("recut_sprite");
    const queued = withImage.tools.find((t) => t.name === "generate_image")!.description;
    expect(queued).toContain("骨架");
    // 「提前 3–5 句」是拍脑袋的经验值（流式下只给图 3–5 秒头，真要一分多钟），已随风格一起撤掉
    expect(queued).not.toContain("3–5 句");
  });

  it("没配 Exa 就不注册 web_search，配了才装（且两个角色同一份实现）", () => {
    const exa = { search: async () => [] } as never;
    expect(names(playwriter())).not.toContain("web_search");
    expect(names(playwriter({ exa }))).toContain("web_search");
    expect(names(workshop())).not.toContain("web_search");
    expect(names(workshop({ exa }))).toContain("web_search");
  });

  it("play.json 的启用集最后一道过滤：装出来再摘掉，能力位跟着翻", () => {
    const kit = workshop({}, ["skill"]);
    expect(names(kit)).not.toContain("generate_image");
    expect(kit.can.image).toBe(false);
    expect(kit.can.library).toBe(false);
    expect(kit.can.search).toBe(false);
    expect(kit.can.skill).toBe(true);
    // read 是基座：一个能力都不开也留着（角色卡要能自己 read 出来）
    expect(names(kit)).toContain("read");
    expect(kit.can.files).toBe(false);
  });

  it("勾上命令行才装 bash，能力位跟着翻", () => {
    const without = workshop();
    expect(without.can.shell).toBe(false);
    expect(names(without)).not.toContain("bash");

    const withBash = workshop({}, [...defaultCapabilitiesFor("workshop"), "shell"]);
    expect(withBash.can.shell).toBe(true);
    expect(names(withBash)).toContain("bash");
  });

  it("舞台那两位常开：不给开关，也不写进 play.json", () => {
    const kit = playwriter({}, []);
    // 一个能力都不开 = 只剩常开与基座
    expect(names(kit)).toEqual(["beat_done", "read", "update_state"]);
    expect(kit.can.stage).toBe(true);
    expect(kit.can.memory).toBe(false);
    expect(kit.can.characters).toBe(false);
  });

  it("思考档位缺省 off，给了就透出", () => {
    expect(playwriter().thinking).toBe("default");
    expect(workshop().thinking).toBe("default");
    expect(workshop({}, []).thinking).toBe("default");
    const kit = createAgentKit({ ...workshopDeps({ thinking: "high" }) });
    expect(kit.thinking).toBe("high");
  });
});

describe("agent kit：能力目录（设置页的数据源）", () => {
  it("能力层声明的每个工具都在工具目录里，且每个工具都有能力认领——两头的孤儿都必红", () => {
    const catalog = new Set(allToolIds());
    const granted = new Set(CAPABILITY_CATALOG.flatMap((cap) => [...cap.tools]));
    for (const cap of CAPABILITY_CATALOG) {
      for (const id of cap.tools) {
        expect(catalog.has(id), `能力 ${cap.id} 声明了不在工具目录里的 ${id}`).toBe(true);
      }
    }
    for (const id of catalog) {
      if ((BASE_TOOLS as readonly string[]).includes(id)) continue;
      expect(granted.has(id), `工具 ${id} 没有被任何能力授权，谁都勾不到`).toBe(true);
    }
  });

  it("工具目录里的每个 id 都有副作用声明——两个方向都不许有孤儿", () => {
    // 反向对账：上面那条查「能力↔工具目录」，这条查「工具目录↔副作用目录」。
    // 少了它，新增一个工具却忘了在 TOOL_SIDE_EFFECT_CATALOG 里登记，只要这一轮没装到它
    // 就永远不会红——而契约声明的是「每个工具九项声明」。
    const sideEffects = new Set(Object.keys(TOOL_SIDE_EFFECT_CATALOG));
    for (const id of allToolIds()) {
      expect(sideEffects.has(id), `工具 ${id} 在工具目录里，却没有副作用声明`).toBe(true);
    }
  });

  it("目录按角色出，每条有中文名字、一句后果与分组；常开行带 locked", () => {
    const rows = capabilityCatalog("playwriter", FULL_ENV);
    expect(rows.map((r) => r.id)).toEqual(["stage", "nsfw", "characters", "memory", "image", "library", "search"]);
    for (const row of rows) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.desc.length).toBeGreaterThan(0);
      expect(row.groupLabel.length).toBeGreaterThan(0);
    }
    expect(rows.find((r) => r.id === "stage")!.locked).toBe(true);
    expect(rows.find((r) => r.id === "characters")!.locked).toBe(false);
    // 界面不出现工具名：后果那句里不能有工具 id
    for (const row of rows) expect(row.desc).not.toMatch(/generate_image|list_library|web_search|write\b/);
    // 工坊那张卡上不会有「结束本轮」
    expect(capabilityCatalog("workshop", FULL_ENV).map((r) => r.id)).toEqual([
      "voice",
      "files",
      "image",
      "music",
      "library",
      "search",
      "lineage",
      "skill",
      "view",
      "readiness",
      "shell",
    ]);
  });

  it("服务端没配的东西亮「暂不生效」，但开关照旧给", () => {
    const rows = capabilityCatalog("workshop", { search: false, voice: false, image: false, music: false });
    const voice = rows.find((r) => r.id === "voice")!;
    expect(voice.available).toBe(false);
    expect(voice.unavailableNote).toContain("TTS");
    expect(rows.find((r) => r.id === "search")!.available).toBe(false);
    expect(rows.find((r) => r.id === "image")!.available).toBe(false);
    expect(rows.find((r) => r.id === "music")!.available).toBe(false);
    // 不依赖服务端配置的能力照旧可用，也不给说明
    expect(rows.find((r) => r.id === "files")!.available).toBe(true);
    expect(rows.find((r) => r.id === "files")!.unavailableNote).toBeUndefined();
  });

  it("剧作家默认关「管理角色」、开「记忆」；工坊默认开全除命令行", () => {
    const playDefault = defaultCapabilitiesFor("playwriter");
    expect(playDefault).toContain("memory");
    expect(playDefault).not.toContain("characters");
    expect(playDefault).not.toContain("stage"); // 常开不写进启用集
    expect(defaultCapabilitiesFor("workshop")).toEqual(
      capabilityCatalog("workshop", FULL_ENV)
        .filter((r) => !r.locked && r.id !== "shell")
        .map((r) => r.id),
    );
  });

  it("启用集解析：未知 id 丢弃、常开项丢弃、空数组 = 只剩常开", () => {
    expect([...enabledCapabilitiesFor("playwriter", ["memory", "no_such_cap", "stage"])]).toEqual(["memory"]);
    expect([...enabledCapabilitiesFor("workshop", [])]).toEqual([]);
    // 没写 = 走默认
    expect([...enabledCapabilitiesFor("playwriter")].sort()).toEqual([...defaultCapabilitiesFor("playwriter")].sort());
  });
});

describe("agent kit：能力 → 工具与文件面", () => {
  it("装上的工具 = 基座 ∪ 开着的能力授权的工具", () => {
    for (const role of AGENT_ROLES) {
      // 依赖面配齐：web_search 卡在 Exa 上，配置缺了工具装不出来，那不是能力层的事
      const exa = { search: async () => [] } as never;
      for (const caps of [[], defaultCapabilitiesFor(role), ["image"]]) {
        const expected = new Set<string>(BASE_TOOLS);
        for (const cap of CAPABILITY_CATALOG) {
          if (!cap.roles.includes(role)) continue;
          if (!cap.locked && !caps.includes(cap.id as never)) continue;
          for (const id of capabilityTools(cap, role)) expected.add(id);
        }
        const kit = role === "playwriter" ? playwriter({ exa }, caps) : workshop({ exa }, caps);
        expect(new Set(names(kit))).toEqual(expected);
      }
    }
  });

  it("同一个能力在两个角色上授权的工具按角色收：剧作家不拿 recut_sprite / commit_asset / import_asset", () => {
    const image = CAPABILITY_CATALOG.find((c) => c.id === "image")!;
    const library = CAPABILITY_CATALOG.find((c) => c.id === "library")!;
    expect(capabilityTools(image, "playwriter")).toEqual(["generate_image"]);
    expect(capabilityTools(image, "workshop")).toEqual(["generate_image", "recut_sprite", "commit_asset"]);
    expect(capabilityTools(library, "playwriter")).toEqual(["list_library"]);
    expect(capabilityTools(library, "workshop")).toEqual(["list_library", "import_asset"]);
    expect(installableTools("playwriter")).not.toContain("import_asset");
    expect(names(playwriter())).not.toContain("import_asset");
  });

  it("写面是能力的并集：剧作家记忆开着只有记忆卡，工坊拿到三位", () => {
    expect(writeScopesFor("playwriter", new Set(defaultCapabilitiesFor("playwriter")))).toEqual(["memory"]);
    expect(writeScopesFor("playwriter", new Set(["characters", "memory"]))).toEqual(["characters", "memory"]);
    expect(writeScopesFor("workshop", new Set(defaultCapabilitiesFor("workshop")))).toEqual([
      "characters",
      "memory",
      "config",
    ]);
    expect(writeScopesFor("workshop", new Set(["skill"]))).toEqual([]);
    // 常开的 stage 不带写面
    expect(writeScopesFor("playwriter", new Set())).toEqual([]);
    expect(enabledToolsFor("workshop", new Set())).toEqual(new Set(BASE_TOOLS));
  });

  it("工厂装出来的工具与工具目录登记的角色逐项对上——新增工具忘了标角色，这条必红", () => {
    // 比的是工厂原样产物（`roleTools`），不是过滤后的结果：拿启用集和自己比，多装一个也看不出来。
    // 依赖都配齐来比：web_search 卡在 Exa key 上，资源库两个卡在库目录上，list_voices 卡在 TTS 上。
    const exa = { search: async () => [] } as never;
    const deps = { playwriter: playwriterDeps({ exa }), workshop: workshopDeps({ exa }) };
    for (const role of AGENT_ROLES) {
      expect(roleToolNames(deps[role]), role).toEqual(installableTools(role).sort());
    }
  });

  it("两个角色的资源库工具是同一份实现（剧作家只是没有对话流可挂气泡）", () => {
    const a = playwriter();
    const b = workshop();
    const ta = a.tools.find((t) => t.name === "list_library")!;
    const tb = b.tools.find((t) => t.name === "list_library")!;
    expect(ta.parameters).toBe(tb.parameters);
    expect(ta.description).toBe(tb.description);
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
