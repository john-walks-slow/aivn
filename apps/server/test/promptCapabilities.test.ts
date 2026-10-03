import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/prompt.js";
import { buildWorkshopPrompt, type WorkshopPromptContext } from "../src/workshop.js";
import {
  CAPABILITY_TOOLS,
  agentToolCatalog,
  capabilitiesOf,
  type AgentCapabilities,
} from "../src/agentkit/kit.js";
import { AGENT_ROLES } from "../src/agentkit/role.js";
import { caps, PLAY } from "./helpers.js";

/**
 * 能力位的表达与消费：两位角色的 system prompt 读**同一个** `kit.can`。
 *
 * 这里盯的是那类「只改一边」的漂移：加能力位时只给一个角色的提示词收了条件，
 * 另一个就还在教模型调一个装不进去的工具（题面唯一真相源是 `CAPABILITY_TOOLS`）。
 */

/** 工坊提示词的装配输入（本文件只关心能力位，其余给最小可跑值）。 */
const workshopCtx = (can: AgentCapabilities): WorkshopPromptContext => ({
  title: "T",
  files: "- play.json",
  readiness: { ready: true, missing: [] } as never,
  can,
});

describe("能力位：一位对应一个工具", () => {
  it("表里每个工具都真在工具目录里——写错一个名字，这一位就永远是 false", () => {
    const known = new Set(agentToolCatalog().map((entry) => entry.id));
    // 装不上的工具不该占一位：没人能勾的开关，提示词永远不会为它开章
    const installable = new Set(
      AGENT_ROLES.flatMap((role) => agentToolCatalog(role).map((entry) => entry.id)),
    );
    for (const [key, tool] of Object.entries(CAPABILITY_TOOLS)) {
      expect(known.has(tool), `能力位 ${key} 指向的工具 ${tool} 不在工具目录里`).toBe(true);
      expect(installable.has(tool), `能力位 ${key} 指向的工具 ${tool} 两个角色都装不上`).toBe(true);
    }
  });

  it("capabilitiesOf：表里有几位就出几位，装了才为 true", () => {
    expect(Object.keys(capabilitiesOf([])).sort()).toEqual(Object.keys(CAPABILITY_TOOLS).sort());
    expect(Object.values(capabilitiesOf([]))).toEqual(Object.keys(CAPABILITY_TOOLS).map(() => false));
    expect(capabilitiesOf([{ name: "generate_image" }, { name: "bash" }]))
      .toEqual({ ...caps({ image: true, shell: true }) });
  });
});

describe("两份提示词读同一套能力位", () => {
  it("同一个能力集对象喂两边：剧作家与搭台助手都收得下", async () => {
    const shared: AgentCapabilities = caps({ library: true });
    expect(buildSystemPrompt({ play: PLAY, can: shared })).toContain("list_library");
    expect(await buildWorkshopPrompt(workshopCtx(shared))).toContain("list_library");
  });

  it("库不可用：两边都不提 list_library（工具压根没注册）", async () => {
    const can = caps({ library: false });
    const playwriter = buildSystemPrompt({ play: PLAY, can });
    const workshop = await buildWorkshopPrompt(workshopCtx(can));
    expect(playwriter).not.toContain("list_library");
    expect(playwriter).not.toContain("引用一个剧目里还没有的 id");
    expect(workshop).not.toContain("list_library");
    expect(workshop).not.toContain("import_asset");
  });

  it("生图不可用：两边都换成降级说明，不给出图那套做法", async () => {
    const can = caps({ image: false });
    const playwriter = buildSystemPrompt({ play: PLAY, can });
    const workshop = await buildWorkshopPrompt(workshopCtx(can));
    expect(playwriter).toContain("本剧目没有开启生图");
    expect(playwriter).not.toContain("## 自己出图（generate_image）");
    expect(workshop).toContain("生图当前不可用");
    expect(workshop).not.toContain("先出 neutral 定妆照");
  });

  it("生图可用：两边都把出图那一章接回来", async () => {
    const can = caps({ image: true });
    expect(buildSystemPrompt({ play: PLAY, can })).toContain("## 自己出图（generate_image）");
    expect(await buildWorkshopPrompt(workshopCtx(can))).toContain("先出 neutral 定妆照");
  });

  it("联网检索：两边由同一位决定注不注 SEARCH_GUIDE", async () => {
    const on = caps({ search: true });
    expect(buildSystemPrompt({ play: PLAY, can: on })).toContain("# 联网检索（web_search）");
    expect(await buildWorkshopPrompt(workshopCtx(on))).toContain("# 联网检索（web_search）");

    const off = caps({ search: false });
    expect(buildSystemPrompt({ play: PLAY, can: off })).not.toContain("web_search");
    expect(await buildWorkshopPrompt(workshopCtx(off))).not.toContain("web_search");
  });

  it("剧作家只读 image / search / library 三位，voice / shell 与它无关", () => {
    // 剧作家的工具集里没有 list_voices / bash：给它开这两位不该改变一个字。
    const base = buildSystemPrompt({ play: PLAY, can: caps() });
    const noisy = buildSystemPrompt({ play: PLAY, can: caps({ voice: true, shell: true }) });
    expect(noisy).toBe(base);
  });
});
