import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentKit, defaultCapabilitiesFor } from "../src/agentkit/kit.js";
import type { PlaywriterKitDeps, WorkshopKitDeps, PlayFileWrite } from "../src/agentkit/deps.js";
import { PlayFiles } from "../src/playFiles.js";
import { PlayMemory } from "../src/memory.js";
import { LineageTree } from "@aivn/core";

/**
 * `PlayEnv` 是 pi 内建工具（read / write / edit / bash）与剧目文件之间唯一的那层装饰。
 *
 * 它管两件事，这里逐个钉住：**路径白名单**（read / write / edit 走它，bash 不走）、
 * **play.json 的结构校验**。pi 那边的匹配语义
 * （精确→模糊、唯一性、BOM/行尾）是 pi 自己的事，不在这里重测。
 */

const PLAY_CONFIG = {
  id: "test",
  title: "测试剧目",
  premise: "测试 premise",
  characters: [{ id: "mio", name: "澪", persona: "测试角色" }],
  opening: "（开始）",
  initialState: { turn: 0, affinity: {}, flags: {} },
  initialScene: "走廊",
};

async function tempPlay(): Promise<{ dir: string; writes: PlayFileWrite[]; config: string }> {
  const dir = await mkdtemp(join(tmpdir(), "stage-play-env-"));
  const config = JSON.stringify(PLAY_CONFIG, null, 2);
  await mkdir(join(dir, "memory", "always"), { recursive: true });
  await writeFile(join(dir, "play.json"), config, "utf8");
  await writeFile(join(dir, "memory", "always", "craft.md"), "# 画风\n柔和的夏日色调。\n", "utf8");
  await writeFile(join(dir, "session.json"), "{}", "utf8");
  return { dir, writes: [], config };
}

/** 真装配出来的一套工具（含 bash）——测的是 agent 实际拿到的那份。 */
function toolset(dir: string, writes: PlayFileWrite[]) {
  const deps = {
    role: "workshop",
    playId: "test",
    capabilities: new Set([...defaultCapabilitiesFor("workshop"), "shell"]),
    files: new PlayFiles({ dir } as never),
    store: {} as never,
    onWrite: (w: PlayFileWrite) => writes.push(w),
    onAsset: () => {},
    saves: {} as never,
    saveStore: () => ({}) as never,
  } as unknown as WorkshopKitDeps;
  const tools = createAgentKit(deps).tools;
  return {
    read: tools.find((t) => t.name === "read")!,
    write: tools.find((t) => t.name === "write")!,
    edit: tools.find((t) => t.name === "edit")!,
    bash: tools.find((t) => t.name === "bash")!,
  };
}

const call = (tool: { execute: (...args: never[]) => Promise<unknown> }, args: unknown): Promise<unknown> =>
  tool.execute("c1" as never, args as never);

describe("PlayEnv：read / write / edit 的路径白名单", () => {
  it("读得到剧目内的文件，读不到白名单外与越界的路径", async () => {
    const { dir, writes } = await tempPlay();
    const { read } = toolset(dir, writes);

    const ok = (await call(read, { path: "play.json" })) as { content: { text: string }[] };
    expect(ok.content[0]!.text).toContain("测试剧目");

    // session.json 是演出状态，工坊看不见（它有 list_saves / read_lineage 走另一条路）
    await expect(call(read, { path: "session.json" })).rejects.toThrow(/不在剧目可读范围/);
    await expect(call(read, { path: "../../etc/passwd" })).rejects.toThrow(/不在剧目目录内|不在剧目可读范围/);
    expect(writes).toEqual([]);
  });

  it("写得动剧目内可写的文件，写不动只读面", async () => {
    const { dir, writes } = await tempPlay();
    const { write } = toolset(dir, writes);

    await call(write, { path: "memory/index/lore/新设定.md", content: "# 新设定\n" });
    expect(await readFile(join(dir, "memory/index/lore/新设定.md"), "utf8")).toBe("# 新设定\n");
    expect(writes).toEqual([{ path: "memory/index/lore/新设定.md" }]);

    // assets/ 读得到、写不了（唯一的例外是素材描述表 assets/manifest.json）
    await expect(call(write, { path: "assets/backgrounds/新背景.png", content: "x" })).rejects.toThrow(
      /不在剧目可写范围/,
    );
    // session.json 连读面都不过，于是更早一步被拦下
    await expect(call(write, { path: "session.json", content: "{}" })).rejects.toThrow(/不在剧目可读范围/);
    expect(writes).toHaveLength(1);
  });
});

describe("PlayEnv：play.json 的结构校验", () => {
  it("write 结构不过就不落盘，并把原因原话回给模型", async () => {
    const { dir, writes, config } = await tempPlay();
    const { write } = toolset(dir, writes);

    // characters 少了 id：parsePlayConfig 会拒
    await expect(call(write, { path: "play.json", content: '{"id":"test"}' })).rejects.toThrow(
      /play.json 结构校验不过/,
    );
    expect(await readFile(join(dir, "play.json"), "utf8")).toBe(config);
    expect(writes).toEqual([]);
  });

  it("edit 改坏了结构同样拦得住（但 pi 的 edit 会把原因吞成错误码）", async () => {
    const { dir, writes, config } = await tempPlay();
    const { edit } = toolset(dir, writes);

    // pi 的 edit 把 `writeFile` 的失败包成 `Could not edit file: <path>. Error code: <code>.`，
    // 具体原因（这里就是「结构校验不过」）只挂在 cause 上，不随工具结果回给模型。
    // 拦得住才是我们要的；消息粒度是 pi 的契约，不在这里造第二套错误面。
    await expect(
      call(edit, { path: "play.json", edits: [{ oldText: '"characters"', newText: '"characters' }] }),
    ).rejects.toThrow(/Could not edit file: play\.json/);
    expect(await readFile(join(dir, "play.json"), "utf8")).toBe(config);
    expect(writes).toEqual([]);
  });
});

describe("PlayEnv：写盘信号（只带路径，各页据此重拉）", () => {
  it("edit 定点替换后落盘，并推出写盘信号", async () => {
    const { dir, writes } = await tempPlay();
    const { edit } = toolset(dir, writes);

    await call(edit, {
      path: "memory/always/craft.md",
      edits: [{ oldText: "柔和的夏日色调。", newText: "柔和的夏日色调，线稿偏细。" }],
    });
    expect(await readFile(join(dir, "memory/always/craft.md"), "utf8")).toBe("# 画风\n柔和的夏日色调，线稿偏细。\n");
    expect(writes).toEqual([{ path: "memory/always/craft.md" }]);
  });

  it("play.json 改对了照样过校验并落盘", async () => {
    const { dir, writes } = await tempPlay();
    const { edit } = toolset(dir, writes);

    await call(edit, { path: "play.json", edits: [{ oldText: '"title": "测试剧目"', newText: '"title": "改过的标题"' }] });
    expect(JSON.parse(await readFile(join(dir, "play.json"), "utf8")).title).toBe("改过的标题");
    expect(writes.map((w) => w.path)).toEqual(["play.json"]);
  });
});

describe("PlayEnv：bash 是另一条路", () => {
  it("工作目录就是剧目目录，能跑 grep / jq 这类命令", async () => {
    const { dir, writes } = await tempPlay();
    const { bash } = toolset(dir, writes);

    const out = (await call(bash, { command: "pwd && grep -rn 夏日 memory/" })) as { content: { text: string }[] };
    expect(out.content[0]!.text).toContain(dir);
    expect(out.content[0]!.text).toContain("夏日");
  });

  it("非零退出码会抛错，把输出一起带回来", async () => {
    const { dir, writes } = await tempPlay();
    const { bash } = toolset(dir, writes);

    await expect(call(bash, { command: "echo 找不到; exit 3" })).rejects.toThrow(/Command exited with code 3/);
  });

  it("bash 绕开文件白名单——这正是提示词要讲清的那条边界", async () => {
    const { dir, writes } = await tempPlay();
    const { bash } = toolset(dir, writes);

    const out = (await call(bash, { command: "cat session.json" })) as { content: { text: string }[] };
    expect(out.content[0]!.text).toContain("{}");
    expect(writes).toEqual([]); // 也不推写盘信号
  });
});

/**
 * 剧作家这一侧：角色卡与记忆卡不再是专用工具，走的是**同一套** read / write / edit
 * （同一个 `PlayEnv`、同一份 `PlayFiles` 白名单）。这里钉住三件事：
 * 写盘要过 `onWrite`（宿主靠它登记角色 id、排轮边界重建）、`edit` 能定点改而不抹掉别的字段、
 * 引擎产物（arcs / archive）看得见但写不进去。
 */
describe("PlayEnv：剧作家的文件工具", () => {
  function playwriterToolset(
    dir: string,
    writes: PlayFileWrite[],
    caps: string[] = defaultCapabilitiesFor("playwriter"),
  ) {
    const deps = {
      role: "playwriter",
      playId: "test",
      capabilities: new Set(caps),
      store: {} as never,
      files: new PlayFiles({ dir } as never),
      onWrite: (w: PlayFileWrite) => writes.push(w),
      engine: { turn: 0, affinity: {}, flags: {} },
      characterIds: new Set<string>(),
      memory: new PlayMemory(),
      tree: new LineageTree(),
      stateFiles: {},
      arcIds: () => [],
      emitStop: () => {},
      emitPreload: () => {},
      kick: () => {},
      kickSprite: () => {},
      existingAssetUrl: async () => null,
      onEnterNsfw: () => {},
      onExitNsfw: () => {},
      isNsfw: () => false,
    } as unknown as PlaywriterKitDeps;
    const tools = createAgentKit(deps).tools;
    return {
      read: tools.find((t) => t.name === "read")!,
      write: tools.find((t) => t.name === "write")!,
      edit: tools.find((t) => t.name === "edit")!,
    };
  }

  const CARD_CAPS = ["characters", "memory"];

  it("写角色卡走通用 write：落盘 + onWrite（宿主据此登记 id、排轮边界重建）", async () => {
    const { dir, writes } = await tempPlay();
    const { write } = playwriterToolset(dir, writes, CARD_CAPS);

    await call(write, {
      path: "characters/xiaoyu.md",
      content: "---\nname: 小雨\nvoiceId: aaa111\n---\n咖啡店打工的少女。\n",
    });
    expect(await readFile(join(dir, "characters", "xiaoyu.md"), "utf8")).toContain("咖啡店打工的少女");
    expect(writes).toEqual([{ path: "characters/xiaoyu.md" }]);
  });

  it("edit 定点改角色卡：只换那一处，机器字段一个不丢（整篇 write 做不到这件事）", async () => {
    const { dir, writes } = await tempPlay();
    const { read, write, edit } = playwriterToolset(dir, writes, CARD_CAPS);

    await call(write, {
      path: "characters/xiaoyu.md",
      content: "---\nname: 小雨\nvoiceId: aaa111\nframing: half\n---\n咖啡店打工的少女。\n",
    });
    await call(edit, { path: "characters/xiaoyu.md", edits: [{ oldText: "咖啡店打工的少女。", newText: "在旧书店打工的少女。" }] });

    const after = (await call(read, { path: "characters/xiaoyu.md" })) as { content: { text: string }[] };
    expect(after.content[0]!.text).toContain("在旧书店打工的少女。");
    // 整篇覆盖那条路会抹掉模型没提到的 voiceId / framing，edit 不会
    expect(after.content[0]!.text).toContain("voiceId: aaa111");
    expect(after.content[0]!.text).toContain("framing: half");
    // **edit 也要回调**：宿主靠它排轮边界重建，漏了这一步改完卡下一轮还是老内容
    expect(writes.map((w) => w.path)).toEqual(["characters/xiaoyu.md", "characters/xiaoyu.md"]);
  });

  it("引擎产物（memory/arcs、memory/archive）写不进去，通用读口也不给读", async () => {
    const { dir, writes } = await tempPlay();
    await mkdir(join(dir, "memory", "arcs"), { recursive: true });
    await writeFile(join(dir, "memory", "arcs", "epoch-a-1.md"), "# 第一纪\n摘要\n", "utf8");
    const { read, write, edit } = playwriterToolset(dir, writes);

    // 通用 read 认不认引擎产物按角色分：这两条目录跟分支走，剧作家读出来就是别的世界线的纪元摘要
    await expect(call(read, { path: "memory/arcs/epoch-a-1.md" })).rejects.toThrow(/引擎产物走不了通用读写口/);
    for (const path of ["memory/arcs/epoch-a-1.md", "memory/ARCS/epoch-a-1.md", "memory/Archive/x.md"]) {
      // 大小写也要挡住：Windows / macOS 上这几个是同一个文件；写走同一条路径解析，也一起拒
      await expect(call(write, { path, content: "改掉" })).rejects.toThrow(/引擎产物走不了通用读写口/);
    }
    // edit 也拒在路径解析这一步：读面就先挡下了，pi 不再往 writeFile 走、原话直接回给模型
    await expect(
      call(edit, { path: "memory/arcs/epoch-a-1.md", edits: [{ oldText: "第一纪", newText: "改掉" }] }),
    ).rejects.toThrow(/引擎产物走不了通用读写口/);
    expect(await readFile(join(dir, "memory", "arcs", "epoch-a-1.md"), "utf8")).toContain("第一纪");
    expect(writes).toEqual([]);
  });

  it("「管理角色」关着时：写角色卡被拒，读角色卡照旧（read 是基座工具）", async () => {
    const { dir, writes } = await tempPlay();
    await mkdir(join(dir, "characters"), { recursive: true });
    await writeFile(join(dir, "characters", "mio.md"), "---\nname: 澪\n---\n走廊上的少女。\n", "utf8");
    const { read, write } = playwriterToolset(dir, writes); // 默认集：memory 开、characters 关

    await expect(call(write, { path: "characters/xiaoyu.md", content: "---\nname: 小雨\n---\n" })).rejects.toThrow(
      /没给这个角色开改角色卡的能力/,
    );
    await expect(call(write, { path: "play.json", content: "{}" })).rejects.toThrow(
      /没给这个角色开改剧目文件的能力/,
    );
    // 默认集里 memory 开着，记忆卡不受影响
    await call(write, { path: "memory/index/lore/新设定.md", content: "# 新设定\n" });
    expect(writes.map((w) => w.path)).toEqual(["memory/index/lore/新设定.md"]);

    // 角色表折叠时模型要能自己把完整人设 read 出来：读口不受「管理角色」影响
    const ok = (await call(read, { path: "characters/mio.md" })) as { content: { text: string }[] };
    expect(ok.content[0]!.text).toContain("走廊上的少女。");
  });
});

/**
 * 「scope 挂在 PlayEnv、不挂 PlayFiles」这条决定的防回归钉子：
 * 工坊关掉「改剧目文件」之后，**用户面**的四条路（文件页读写删、craft / premise 写口、
 * `applyChanges` 的读盘检查、`view_image` 的本地分支）都得照旧——它们共用同一个 `PlayFiles` 实例。
 */
describe("PlayEnv：关掉「改剧目文件」不打断工坊自己的 PlayFiles", () => {
  function workshopTools(dir: string, writes: PlayFileWrite[], caps: string[]) {
    const deps = {
      role: "workshop",
      playId: "test",
      capabilities: new Set(caps),
      files: new PlayFiles({ dir } as never),
      store: {} as never,
      onWrite: (w: PlayFileWrite) => writes.push(w),
      onAsset: () => {},
      saves: {} as never,
      saveStore: () => ({}) as never,
    } as unknown as WorkshopKitDeps;
    const tools = createAgentKit(deps).tools;
    return { files: deps.files, write: tools.find((t) => t.name === "write")! };
  }

  it("「改剧目文件」关着时 agent 没有写口，文件页与 craft 写口用的那份 PlayFiles 照旧", async () => {
    const { dir, writes } = await tempPlay();
    const { files, write } = workshopTools(dir, writes, []); // 一个能力都不开

    // 写口就是「改剧目文件」这个能力给的：关掉之后 write / edit 根本不装，模型连试的机会都没有
    expect(write).toBeUndefined();

    // 文件页（http.ts 经 runtime.workshop.files 读 / 写 / 删）与 craft 写口走的是同一个实例
    expect(await files.read("play.json")).toContain("测试剧目");
    await files.write("theme.css", ":root { --accent: #f00; }");
    expect(await readFile(join(dir, "theme.css"), "utf8")).toContain("--accent");
    await files.write("memory/always/premise.md", "# 前提\n");
    await files.remove("memory/always/premise.md");
    // applyChanges 的读盘检查：play.json 解析得了，就不该被 agent 的能力面挡住
    expect(JSON.parse(await files.read("play.json")).title).toBe("测试剧目");
  });

  it("工坊的通用读口看得见引擎产物（它要能读用户手上的剧目全貌）", async () => {
    const { dir, writes } = await tempPlay();
    await mkdir(join(dir, "memory", "archive"), { recursive: true });
    await writeFile(join(dir, "memory", "archive", "turn-1.md"), "# 第一轮\n", "utf8");
    const deps = {
      role: "workshop",
      playId: "test",
      capabilities: new Set(defaultCapabilitiesFor("workshop")),
      files: new PlayFiles({ dir } as never),
      store: {} as never,
      onWrite: (w: PlayFileWrite) => writes.push(w),
      onAsset: () => {},
      saves: {} as never,
      saveStore: () => ({}) as never,
    } as unknown as WorkshopKitDeps;
    const read = createAgentKit(deps).tools.find((t) => t.name === "read")!;

    const ok = (await call(read, { path: "memory/archive/turn-1.md" })) as { content: { text: string }[] };
    expect(ok.content[0]!.text).toContain("第一轮");
  });
});
