import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMessage } from "@stage-ai/core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { PlayFiles } from "../src/playFiles.js";
import { PlaySaves } from "../src/saves.js";
import { PlayStore } from "../src/store.js";
import { Limiter } from "../src/limiter.js";
import { PlayAssets } from "../src/playAssets.js";
import type { GeneratedPlayAsset } from "../src/playAssets.js";
import { WorkshopThreads } from "../src/workshopThreads.js";
import { WorkshopSession } from "../src/workshopSession.js";
import { DEFAULT_CRAFT, resolveCraft } from "@stage-ai/core";
import { buildWorkshopPrompt, deriveThreadTitle, type WorkshopPromptContext } from "../src/workshop.js";
import type { WorkshopKitDeps } from "../src/agentkit/deps.js";
import { createAgentKit, defaultToolsFor, type AgentCapabilities } from "../src/agentkit/kit.js";
import { renderReadiness } from "../src/agentkit/readiness.js";
import { Exa } from "../src/exa.js";
import { createFakeStreamFn, BEAT_1, BEAT_2, PLAY } from "./helpers.js";
import { PlaywrightOrchestrator } from "../src/orchestrator.js";
import { LineageTree } from "@stage-ai/core";
import { PlayMemory } from "../src/memory.js";

/**
 * 测试用的工具装配。工坊与剧作家共用一个基座（`createAgentKit`），这里只固定 role 与空开关，
 * 各条用例继续按依赖面传参（files / store / playAssets / exa…）——测的就是真实那份装配。
 */
type WorkshopTestDeps = Omit<WorkshopKitDeps, "role" | "playId" | "disabled">;
const createWorkshopTools = (deps: WorkshopTestDeps) =>
  createAgentKit({ role: "workshop", playId: "test", enabled: new Set(defaultToolsFor("workshop")), ...deps }).tools;

/** 造一个带最小剧目目录的 PlayStore：play.json + 记忆卡 + 会话日志（后者必须不可见）。 */
async function makeStore(): Promise<PlayStore> {
  const dir = await mkdtemp(join(tmpdir(), "stage-workshop-"));
  await mkdir(join(dir, "memory", "always"), { recursive: true });
  await mkdir(join(dir, "memory", "index", "lore"), { recursive: true });
  await mkdir(join(dir, "assets", "backgrounds"), { recursive: true });
  await writeFile(
    join(dir, "play.json"),
    JSON.stringify({
      id: "test",
      title: "测试剧目",
      premise: "测试 premise",
      characters: [{ id: "mio", name: "澪", persona: "测试角色" }],
      opening: "（开始）",
      initialState: { turn: 0, affinity: {}, flags: {} },
      initialScene: "走廊",
    }),
  );
  await writeFile(join(dir, "memory", "always", "premise.md"), "# 前提\n走廊的故事。\n");
  await writeFile(join(dir, "memory", "index", "lore", "旧约定.md"), "# 旧约定\n约定。\n");
  await writeFile(join(dir, "session.json"), "{}");
  await writeFile(join(dir, "lineage.jsonl"), "");
  await writeFile(join(dir, "assets", "backgrounds", "corridor.png"), "png");
  return new PlayStore(dir);
}

describe("PlayFiles：剧目文件白名单", () => {
  it("可写面是 play.json + memory/**，会话日志与素材不可见", async () => {
    const files = new PlayFiles(await makeStore());
    const listed = (await files.list()).map((f) => f.path);
    expect(listed).toContain("play.json");
    expect(listed).toContain("memory/always/premise.md");
    expect(listed).toContain("memory/index/lore/旧约定.md");
    expect(listed).toContain("assets/backgrounds/corridor.png");
    expect(listed).not.toContain("session.json");
    expect(listed).not.toContain("lineage.jsonl");
    expect((await files.list()).find((f) => f.path === "assets/backgrounds/corridor.png")?.writable).toBe(false);
  });

  it("越界与非法路径一律拒绝（不裁剪、不尽力而为）", async () => {
    const files = new PlayFiles(await makeStore());
    for (const bad of ["session.json", "lineage.jsonl", "../secret", "/etc/passwd", "memory/../session.json"]) {
      await expect(files.read(bad)).rejects.toThrow();
      await expect(files.write(bad, "x")).rejects.toThrow();
    }
    // 素材可列不可写；二进制不进编辑器——预览走静态路由，read 直接拒绝
    await expect(files.read("assets/backgrounds/corridor.png")).rejects.toThrow("用预览查看");
    await expect(files.write("assets/backgrounds/corridor.png", "x")).rejects.toThrow();
  });

  it("kind 标出预览方式：文本可编辑，图片/音频/其他二进制各自成类", async () => {
    const store = await makeStore();
    await mkdir(join(store.dir, "assets", "bgm"), { recursive: true });
    await writeFile(join(store.dir, "assets", "bgm", "rain.mp3"), "mp3");
    await writeFile(join(store.dir, "assets", "backgrounds", "notes.bin"), "x");
    const files = new PlayFiles(store);
    const kindOf = async (path: string): Promise<string | undefined> =>
      (await files.list()).find((f) => f.path === path)?.kind;
    expect(await kindOf("memory/always/premise.md")).toBe("text");
    expect(await kindOf("assets/backgrounds/corridor.png")).toBe("image");
    expect(await kindOf("assets/bgm/rain.mp3")).toBe("audio");
    expect(await kindOf("assets/backgrounds/notes.bin")).toBe("binary");
  });

  it("play.json 任何入口都删不掉（剧目定义不可恢复）", async () => {
    const files = new PlayFiles(await makeStore());
    await expect(files.remove("play.json")).rejects.toThrow("不可删除");
    await expect(files.remove("assets/backgrounds/corridor.png")).rejects.toThrow();
  });

  it("写入自动建目录并落盘", async () => {
    const store = await makeStore();
    const files = new PlayFiles(store);
    await files.write("memory/index/locations/旧校舍.md", "# 旧校舍\n");
    expect(await readFile(join(store.dir, "memory/index/locations/旧校舍.md"), "utf8")).toContain("# 旧校舍");
  });

  it("play.json 的结构校验长在唯一的文本写口上（文件页手写也绕不过）", async () => {
    const store = await makeStore();
    const files = new PlayFiles(store);
    const before = await readFile(join(store.dir, "play.json"), "utf8");

    await expect(files.write("play.json", "{ 不是 JSON")).rejects.toThrow("play.json 结构校验不过，未落盘");
    // 合法 JSON 但不合剧目契约（缺 title），同样拦在落盘前
    await expect(files.write("play.json", JSON.stringify({ id: "test" }))).rejects.toThrow("缺少必填字段");
    expect(await readFile(join(store.dir, "play.json"), "utf8")).toBe(before);

    // 结构契约只加在 play.json 上，其它文本文件照写
    await files.write("memory/index/lore/随手写.md", "随便什么\n");
    expect(await readFile(join(store.dir, "memory/index/lore/随手写.md"), "utf8")).toBe("随便什么\n");
  });

  it("二进制通道只开图像素材目录，文本工具写不了图片、图像通道也写不了文本", async () => {
    const store = await makeStore();
    const files = new PlayFiles(store);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    await files.writeBinary("assets/sprites/mio/smile.png", png);
    expect((await readFile(join(store.dir, "assets/sprites/mio/smile.png"))).equals(png)).toBe(true);
    // 清旧图：覆盖生图换了扩展名时只留一张
    await files.removeAsset("assets/sprites/mio/smile.png");
    expect(existsSync(join(store.dir, "assets/sprites/mio/smile.png"))).toBe(false);

    for (const bad of [
      "memory/always/premise.md", // 文本面走 write，不走二进制通道
      "assets/notes.txt", // 素材目录下的非图像
      "assets/bgm/theme.mp3", // 非图像格式
      "play.json",
      "../escape.png",
    ]) {
      await expect(files.writeBinary(bad, png)).rejects.toThrow();
      await expect(files.removeAsset(bad)).rejects.toThrow();
    }
  });

  it("二进制通道有体积上限", async () => {
    const files = new PlayFiles(await makeStore());
    await expect(files.writeBinary("assets/cg/big.png", Buffer.alloc(17 * 1024 * 1024))).rejects.toThrow(/素材过大/);
  });
});

describe("工坊 prompt 与工具", () => {
  /** 能力位（`kit.can`）：提示词按它决定注不注某一章。 */
  const caps = (over: Partial<AgentCapabilities> = {}): AgentCapabilities => ({
    image: true,
    search: false,
    library: false,
    voice: false,
    shell: false,
    ...over,
  });

  const promptCtx = (over: Partial<WorkshopPromptContext> = {}): WorkshopPromptContext => ({
    title: "测试剧目",
    files: "- play.json",
    readiness: { ready: true, premise: true, characterSprites: false, background: false, saves: 0 },
    craft: DEFAULT_CRAFT,
    can: caps(),
    ...over,
  });

  /** 造一组带故事树读能力的工具：造一棵周目会话面（saves/<id>/session.json）。 */
  async function makeToolset(): Promise<{
    store: PlayStore;
    tools: ReturnType<typeof createWorkshopTools>;
    writes: string[];
  }> {
    const store = await makeStore();
    const writes: string[] = [];
    const tools = createWorkshopTools({
      files: new PlayFiles(store),
      store,
      onWrite: (w) => writes.push(w.path),
      saves: new PlaySaves(store.dir),
      saveStore: (saveId) => new PlayStore(store.dir, saveId),
    });
    return { store, tools, writes };
  }

  /** 造一棵有台词与分岔的树并落盘成周目。 */
  async function seedSave(store: PlayStore, saveId: string): Promise<void> {
    const tree = new LineageTree();
    tree.append("scene", { payload: { attrs: { bg: "corridor" } } });
    tree.append("say", { text: "澪：早上好。", payload: { attrs: { who: "mio" } } });
    const branch = tree.append("player", { payload: { input: "我点头" } });
    tree.jumpTo(branch.id);
    tree.append("say", { text: "澪：你不说话呀。", payload: { attrs: { who: "mio" } } });
    const save = new PlayStore(store.dir, saveId);
    await save.saveSession(tree, { turn: 2, affinity: {}, flags: {} }, "走廊");
    await writeFile(join(store.dir, "saves", saveId, "meta.json"), JSON.stringify({
      id: saveId,
      name: `周目 ${saveId}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      beats: 1,
      preview: "澪：你不说话呀。",
    }));
  }

  it("write 校验 play.json：坏结构不落盘并把错误回给模型", async () => {
    const { store, tools, writes } = await makeToolset();
    const writeTool = tools.find((t) => t.name === "write")!;

    await expect(
      writeTool.execute("c1", { path: "play.json", content: '{"id":"test"}' }, undefined as never),
    ).rejects.toThrow(/play.json 结构校验不过/);
    expect(writes).toEqual([]);
    expect(JSON.parse(await readFile(join(store.dir, "play.json"), "utf8")).title).toBe("测试剧目");

    await writeTool.execute(
      "c2",
      { path: "memory/always/premise.md", content: "# 新前提\n改了。\n" },
      undefined as never,
    );
    expect(await readFile(join(store.dir, "memory/always/premise.md"), "utf8")).toBe("# 新前提\n改了。\n");
    expect(writes).toEqual(["memory/always/premise.md"]);
  });

  it("read 返回可读文本，越界返回失败而非抛穿", async () => {
    const { tools } = await makeToolset();
    const readTool = tools.find((t) => t.name === "read")!;
    const ok = (await readTool.execute("c1", { path: "play.json" }, undefined as never)) as {
      content: { text: string }[];
    };
    expect(ok.content[0]!.text).toContain("测试剧目");
    await expect(readTool.execute("c2", { path: "session.json" }, undefined as never)).rejects.toThrow(
      /不在工坊可读范围/,
    );
  });

  it("list_saves 列出周目并标出活动档，没有周目时给空提示", async () => {
    const { store, tools } = await makeToolset();
    const listSaves = tools.find((t) => t.name === "list_saves")!;

    expect(JSON.stringify(await listSaves.execute("c1", {}, undefined as never))).toContain("还没有任何周目");

    await seedSave(store, "s1");
    await writeFile(join(store.dir, "saves", "s1", "meta.json"), JSON.stringify({
      id: "s1",
      name: "第一周目",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      beats: 3,
      preview: "澪：你不说话呀。",
    }));
    const text = JSON.stringify(await listSaves.execute("c2", {}, undefined as never));
    expect(text).toContain("s1");
    expect(text).toContain("第一周目");
    expect(text).toContain("3 轮");
  });

  it("read_lineage 只给当前分支，全量模式才带上废弃分支", async () => {
    const { store, tools } = await makeToolset();
    await seedSave(store, "s1");
    const readLineage = tools.find((t) => t.name === "read_lineage")!;

    const pathOnly = JSON.stringify(await readLineage.execute("c1", { saveId: "s1" }, undefined as never));
    expect(pathOnly).toContain("澪：早上好。");
    expect(pathOnly).toContain("澪：你不说话呀。");
    expect(pathOnly).toContain("当前分支路径");
    expect(pathOnly).not.toContain("废弃分支）");
    // 两条 say 都在当前路径上，但 fork 出来的前一版 player 之前的分支不在这条链上
    expect(pathOnly).not.toContain("废弃分支");

    const all = JSON.stringify(
      await readLineage.execute("c2", { saveId: "s1", allBranches: true }, undefined as never),
    );
    expect(all).toContain("全量含废弃分支");
    expect(all).toContain("废弃分支");
  });

  it("read_lineage 事件 kind 译成中文标签，非法 saveId 与空树返回提示而非抛错", async () => {
    const { store, tools } = await makeToolset();
    await seedSave(store, "s1");
    const readLineage = tools.find((t) => t.name === "read_lineage")!;

    const text = JSON.stringify(await readLineage.execute("c1", { saveId: "s1" }, undefined as never));
    expect(text).toContain("场景");
    expect(text).toContain("台词");
    expect(text).toContain("玩家表态");

    expect(JSON.stringify(await readLineage.execute("c2", { saveId: "nope" }, undefined as never))).toContain(
      "周目 nope 不存在",
    );
    expect(JSON.stringify(await readLineage.execute("c3", { saveId: "../etc" }, undefined as never))).toContain(
      "读取失败",
    );
    // 周目存在但没 session.json：说「还没演过」，别让模型以为是空树
    await mkdir(join(store.dir, "saves", "s2"), { recursive: true });
    expect(JSON.stringify(await readLineage.execute("c4", { saveId: "s2" }, undefined as never))).toContain(
      "还没有演出版本",
    );
  });

  it("read_lineage 分页：节点多于 limit 时报还有更多，offset 能翻到下一页", async () => {
    const { store, tools } = await makeToolset();
    const tree = new LineageTree();
    for (let i = 0; i < 5; i += 1) tree.append("say", { text: `第 ${i} 句`, payload: { attrs: { who: "mio" } } });
    const save = new PlayStore(store.dir, "s1");
    await save.saveSession(tree, { turn: 5, affinity: {}, flags: {} }, "走廊");

    const readLineage = tools.find((t) => t.name === "read_lineage")!;
    const first = JSON.stringify(await readLineage.execute("c1", { saveId: "s1", limit: 2 }, undefined as never));
    expect(first).toContain("第 0 句");
    expect(first).not.toContain("第 3 句");
    expect(first).toContain("还有更多");

    const second = JSON.stringify(
      await readLineage.execute("c2", { saveId: "s1", limit: 2, offset: 2 }, undefined as never),
    );
    expect(second).toContain("第 2 句");
    expect(second).toContain("第 3 句");
  });

  it("没有硬门槛：前提与图都只是「还没有」", () => {
    const noImages = renderReadiness({
      premise: true,
      characterSprites: false,
      background: false,
      saves: 0,
    });
    expect(noImages).toContain("没有硬门槛");
    expect(noImages).toContain("缺（建议补）");
    expect(noImages).toContain("不是门槛");

    const noPremise = renderReadiness({
      premise: false,
      characterSprites: true,
      background: true,
      saves: 0,
    });
    // 说人话，不吐字段名：玩家与模型都该看到「缺故事前提」，而不是 `premise`
    expect(noPremise).toContain("不写也行");
    expect(noPremise).toContain("memory/always/premise.md");
    expect(noPremise).not.toContain("play.json 的 premise");
  });

  it("线程标题取首条消息前 20 字", () => {
    expect(deriveThreadTitle("  我想要一个赛博朋克侦探故事  ")).toBe("我想要一个赛博朋克侦探故事");
    expect(deriveThreadTitle("一".repeat(30))).toBe(`${"一".repeat(20)}…`);
  });

  it("工坊 prompt：出图章节只剩职责，工具契约一条都不复述", async () => {
    const prompt = await buildWorkshopPrompt(promptCtx());
    // 画幅归 generate_image 的描述：这里曾抄一份「立绘 9:16 竖构图全身」，
    // 而引擎早已是三档 framing（full 9:16 / half 3:4 / square 1:1）——抄一份就等着漂移。
    expect(prompt).not.toContain("9:16");
    expect(prompt).not.toContain("画幅");
    // 「neutral 不覆盖 normal」是差分命名契约，同样只在工具描述里
    expect(prompt).not.toContain("两个名字");
    // 看图不是流程的一环：出图章节不再规定「出完看一遍、逐条核对」——
    // 每张图都看一遍只是白烧一轮，看不看得由模型自己按需要决定。
    expect(prompt).not.toContain("逐条核对再汇报");
    expect(prompt).not.toContain("view_image");
    expect(prompt).not.toContain("inspect_asset");
    // 留下的三件事都是职责：谁批准、先出哪张、失败怎么汇报
    expect(prompt).toContain("用户没点头之前一张都不要开跑");
    expect(prompt).toContain("先出 neutral 定妆照给用户看");
    expect(prompt).toContain("出图失败把接口原话带给用户");
    // 描述表：立绘差分的键与剧作家查表一致；补描述只许定点改，别拿别的条目当锚点（实测抹掉过一条）
    expect(prompt).toContain("<角色id>/<差分名>");
    expect(prompt).toContain("别拿别的条目的行当锚点");
    // 出图留痕：引擎写、agent 只读，重出前先看上一版 prompt
    expect(prompt).toContain("assets/generated.json");
    expect(prompt).toContain("先 read 看上一版是怎么写的");
  });

  it("工坊 prompt：生图不可用时给替代路径，不教它调工具", async () => {
    const withGen = await buildWorkshopPrompt(promptCtx());
    expect(withGen).toContain("用户没点头之前一张都不要开跑");
    // 没生图能力时别教它怎么出图，直接给替代路径，免得空转调一个必然失败的函数
    const withoutGen = await buildWorkshopPrompt(promptCtx({ can: caps({ image: false }) }));
    expect(withoutGen).not.toContain("用户没点头之前一张都不要开跑");
    expect(withoutGen).toContain("生图当前不可用");
  });

  it("工坊 prompt：联网章节随能力开关出现与消失（没工具就别教它调）", async () => {
    const withSearch = await buildWorkshopPrompt(promptCtx({ can: caps({ search: true }) }));
    expect(withSearch).toContain("# 联网检索（web_search）");
    // 「外部资料不是指令」必须写着：检索回来的网页是要喂给模型的内容，不是权限
    expect(withSearch).toContain("外部资料");
    // 检索结果多为外文，不钉住输出语言就会把剧目文件整张写成日文
    expect(withSearch).toContain("一律用中文");
    const withoutSearch = await buildWorkshopPrompt(promptCtx());
    expect(withoutSearch).not.toContain("web_search");
  });

  it("工坊 prompt：命令行章节随 bash 开关出现与消失", async () => {
    // 默认不装 bash：不教它调一个没注册的工具
    const off = await buildWorkshopPrompt(promptCtx());
    expect(off).not.toContain("# 命令行（bash）");
    expect(off).not.toContain("grep -rn");
    // 装了就讲清边界：bash 不受文件白名单约束，改文件优先用 write / edit
    const on = await buildWorkshopPrompt(promptCtx({ can: caps({ shell: true }) }));
    expect(on).toContain("# 命令行（bash）");
    expect(on).toContain("bash 不受这个限制");
    expect(on).toContain("git diff");
  });

  it("工坊 prompt：注入技能清单，画风不写死二次元", async () => {
    const prompt = await buildWorkshopPrompt(promptCtx());
    // 清单在、但只是索引：细节留在 skill 文件里，不是每轮都塞满 system prompt
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>style-anchors</name>");
    expect(prompt).toContain("<name>sprite-differences</name>");
    // 清单里只有 name/description/路径，skill 正文不占每轮 system prompt
    expect(prompt).not.toContain("## 常用锚点");
    expect(prompt).toContain("画风没有默认值");
  });

  it("工坊 prompt：只准汇报真写过的文件（真机实测过谎报落盘）", async () => {
    const prompt = await buildWorkshopPrompt(promptCtx());
    expect(prompt).toContain("没调 write / edit 的文件一律不许说");
    expect(prompt).toContain("只改几段用 edit");
  });
});

describe("工坊工具：generate_image", () => {
  const deps = (over: Partial<Parameters<typeof createWorkshopTools>[0]> = {}): Parameters<typeof createWorkshopTools>[0] => ({
    files: new PlayFiles(store),
    store,
    onWrite: () => {},
    onAsset: () => {},
    ...over,
  });

  let store: PlayStore;
  const setup = async (): Promise<void> => {
    store = await makeStore();
  };

  it("出图成功：落盘 + 广播 asset + 结果回给模型", async () => {
    await setup();
    const events: GeneratedPlayAsset[] = [];
    const assets = new PlayAssets("test", {
      store,
      files: new PlayFiles(store),
      backend: { generate: async () => ({ data: Buffer.from("x"), mimeType: "image/jpeg" }) },
      limiter: new Limiter(1),
      onWrite: () => {},
    });
    const tools = createWorkshopTools(deps({ playAssets: assets, onAsset: (a) => events.push(a) }));
    const gen = tools.find((t) => t.name === "generate_image")!;

    const out = JSON.stringify(await gen.execute("c1", { kind: "background", name: "rooftop", prompt: "黄昏天台" }));
    expect(out).toContain("已生成：assets/backgrounds/rooftop.jpg");
    // 回执必须带 markdown 图片：agent 要靠这行把图贴给用户看，用户才谈得上验收
    expect(out).toContain("![assets/backgrounds/rooftop.jpg](/plays/test/assets/backgrounds/rooftop.jpg)");
    expect(events).toHaveLength(1);
    expect(events[0]!.url).toBe("/plays/test/assets/backgrounds/rooftop.jpg");
    expect(existsSync(join(store.dir, "assets/backgrounds/rooftop.jpg"))).toBe(true);
  });

  it("view_image：剧目内的图以 image attachment 交给模型（抠底质量只有眼睛能判）", async () => {
    await setup();
    await mkdir(join(store.dir, "assets", "sprites", "mio"), { recursive: true });
    const png = await sharp({
      create: { width: 8, height: 8, channels: 4, background: "#ff00aaff" },
    })
      .png()
      .toBuffer();
    await writeFile(join(store.dir, "assets", "sprites", "mio", "neutral.png"), png);

    const tools = createWorkshopTools(deps());
    const view = tools.find((t) => t.name === "view_image")!;
    const result = await view.execute("c1", { source: "assets/sprites/mio/neutral.png" });
    const image = result.content.find((c) => c.type === "image");
    expect(image).toBeDefined();
    expect(image!.type === "image" && image!.mimeType).toBe("image/png");
    const data = image!.type === "image" ? Buffer.from(image!.data, "base64") : Buffer.alloc(0);
    expect(data.equals(png)).toBe(true);

    const missing = await view.execute("c2", { source: "assets/sprites/mio/nope.png" });
    expect(JSON.stringify(missing)).toContain("读图失败");
  });

  it("view_image：非图片字节不塞进模型，省得白烧一轮", async () => {
    await setup();
    const tools = createWorkshopTools(deps());
    const view = tools.find((t) => t.name === "view_image")!;
    const out = await view.execute("c1", { source: "play.json" });
    expect(out.content.some((c) => c.type === "image")).toBe(false);
    expect(JSON.stringify(out)).toContain("不是一张能看的图");
  });

  it("view_image：网址分支下载后读进来，并缓存到剧目的 media-cache", async () => {
    await setup();
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#3366aa" } })
      .jpeg()
      .toBuffer();
    const asked: string[] = [];
    const tools = createWorkshopTools(
      deps({ webImage: async (url: string) => (asked.push(url), { data: jpeg, mimeType: "image/jpeg" }) }),
    );
    const view = tools.find((t) => t.name === "view_image")!;
    const url = "https://example.com/ref/hero.jpg";
    const result = await view.execute("c1", { source: url });
    expect(asked).toEqual([url]);
    const image = result.content.find((c) => c.type === "image");
    expect(image!.type === "image" && image!.mimeType).toBe("image/jpeg");
    expect(Buffer.from(image!.type === "image" ? image!.data : "", "base64").equals(jpeg)).toBe(true);
    // 回执里带网址：模型要能引用用户给的链接
    expect(JSON.stringify(result)).toContain(url);
    // 落在剧目的 media-cache 下，不进 assets/（外部图不是剧目素材）
    const cached = readdirSync(store.webImageDir());
    expect(cached).toHaveLength(1);
    expect(cached[0]).toMatch(/\.jpg$/);

    // 再看一次同一个网址不再重新下载
    await view.execute("c2", { source: url });
    expect(asked).toHaveLength(1);
  });

  it("view_image：没有下载器时只认本地路径（不装一个必然失败的能力）", async () => {
    await setup();
    const view = createWorkshopTools(deps()).find((t) => t.name === "view_image")!;
    const out = await view.execute("c1", { source: "https://example.com/ref.jpg" });
    expect(JSON.stringify(out)).toContain("看网络图未启用");
  });

  it("抠底参数不在 generate_image 上（出图时没人看过图，填了也是默认值）", async () => {
    await setup();
    const tools = createWorkshopTools(deps());
    const gen = tools.find((t) => t.name === "generate_image")!;
    expect(Object.keys((gen.parameters as { properties: object }).properties)).not.toContain("cutout");
  });

  it("recut_sprite：调参原样走到抠底层，回执带图片给用户看（不用重新出图）", async () => {
    await setup();
    const recuts: unknown[] = [];
    const assets = {
      recut: vi.fn(async (target: { characterId: string; expression?: string }, tuning: unknown) => {
        recuts.push({ ...target, tuning });
        return {
          kind: "sprite" as const,
          path: `assets/sprites/${target.characterId}/${target.expression}.png`,
          url: `/plays/test/assets/sprites/${target.characterId}/${target.expression}.png`,
          replaced: true,
          autoNeutral: false,
        };
      }),
    } as unknown as PlayAssets;
    const events: GeneratedPlayAsset[] = [];
    const tools = createWorkshopTools(deps({ playAssets: assets, onAsset: (asset: GeneratedPlayAsset) => events.push(asset) }));
    const recut = tools.find((t) => t.name === "recut_sprite")!;
    const result = await recut.execute("c1", { characterId: "mio", expression: "neutral", cutout: { weak: 12, minHole: 40 } });
    expect(recuts).toEqual([
      { kind: "sprite", characterId: "mio", expression: "neutral", tuning: { weak: 12, minHole: 40 } },
    ]);
    const out = JSON.stringify(result);
    expect(out).toContain("画面没变");
    // 用户是照这张图验收的：没有图片链接等于让人凭空点头
    expect(out).toContain("![assets/sprites/mio/neutral.png](/plays/test/assets/sprites/mio/neutral.png)");
    expect(events).toHaveLength(1);

    // 失败也要回可读的话（没有留底的老图就是这样），不抛栈
    const failing = { recut: async () => { throw new Error("mio/neutral 没有留底原片"); } } as unknown as PlayAssets;
    const bad = await (createWorkshopTools(deps({ playAssets: failing })).find((t) => t.name === "recut_sprite")!).execute(
      "c2",
      { characterId: "mio" },
    );
    expect(JSON.stringify(bad)).toContain("重抠失败：mio/neutral 没有留底原片");
  });

  it("工坊工具：read_skill 读得到技能全文，读不到就回可读的报错", async () => {
    await setup();
    const tools = createWorkshopTools(deps());
    const read = tools.find((t) => t.name === "read_skill")!;
    const ok = JSON.stringify(await read.execute("c1", { name: "style-anchors" }));
    expect(ok).toContain("画风锚点");
    const bad = JSON.stringify(await read.execute("c1", { name: "nope" }));
    expect(bad).toContain("读取失败");
    expect(bad).toContain("style-anchors");
  });

  it("出图失败：把原因回给模型而不是抛出去（让模型如实转告用户）", async () => {
    await setup();
    const assets = new PlayAssets("test", {
      store,
      files: new PlayFiles(store),
      backend: {
        generate: async () => {
          throw new Error("生图失败 HTTP 503：auth_unavailable");
        },
      },
      limiter: new Limiter(1),
      onWrite: () => {},
    });
    const gen = createWorkshopTools(deps({ playAssets: assets })).find((t) => t.name === "generate_image")!;
    const out = JSON.stringify(
      await gen.execute("c1", { kind: "background", name: "rooftop", prompt: "黄昏天台" }),
    );
    expect(out).toContain("生图失败");
    expect(out).toContain("auth_unavailable");
  });

  it("没配生图后端：直说并给出替代路径，不让模型空转", async () => {
    await setup();
    const gen = createWorkshopTools(deps()).find((t) => t.name === "generate_image")!;
    const out = JSON.stringify(
      await gen.execute("c1", { kind: "background", name: "rooftop", prompt: "黄昏天台" }),
    );
    expect(out).toContain("生图未启用");
  });
});

describe("工坊工具：web_search", () => {
  const deps = (over: Partial<Parameters<typeof createWorkshopTools>[0]> = {}): Parameters<typeof createWorkshopTools>[0] => ({
    files: new PlayFiles(store),
    store,
    onWrite: () => {},
    onAsset: () => {},
    saves: new PlaySaves(store.dir),
    saveStore: (saveId) => new PlayStore(store.dir, saveId),
    ...over,
  });

  let store: PlayStore;
  beforeEach(async () => {
    store = await makeStore();
  });

  /** 假 Exa：只关心工坊这侧怎么把结果端给模型，检索请求的形状由 exa.test.ts 守着。 */
  const stubExa = (search: Exa["search"]): Exa => {
    const exa = Object.create(Exa.prototype) as Exa;
    exa.search = search;
    return exa;
  };

  it("没配 Exa 就不注册这个工具（装一个必然失败的工具只会诱使模型空转）", () => {
    expect(createWorkshopTools(deps()).map((t) => t.name)).not.toContain("web_search");
  });

  it("配了 Exa：结果按「标题 + 链接 + 正文」逐条回给模型", async () => {
    const seen: { query: string; n: number }[] = [];
    const tools = createWorkshopTools(
      deps({
        exa: stubExa(async (query, n) => {
          seen.push({ query, n });
          return [
            { title: "昭和喫茶店内装", url: "https://example.com/caf", publishedDate: "2024-05-01T00:00:00Z", text: "木框窗与吧台" },
          ];
        }),
      }),
    );
    const tool = tools.find((t) => t.name === "web_search")!;
    const out = JSON.stringify(await tool.execute("c1", { query: "昭和喫茶店 内装" }));
    expect(seen).toEqual([{ query: "昭和喫茶店 内装", n: 5 }]);
    expect(out).toContain("昭和喫茶店内装");
    expect(out).toContain("https://example.com/caf");
    expect(out).toContain("2024-05-01");
    expect(out).toContain("木框窗与吧台");
  });

  it("空结果给可执行的下一步，不是一句空回执", async () => {
    const tool = createWorkshopTools(deps({ exa: stubExa(async () => []) })).find((t) => t.name === "web_search")!;
    expect(JSON.stringify(await tool.execute("c1", { query: "不存在的题材" }))).toContain("换个说法");
  });

  it("检索失败把原因回给模型，不往上抛", async () => {
    const tool = createWorkshopTools(
      deps({ exa: stubExa(async () => { throw new Error("exa 全部 key 失败"); }) }),
    ).find((t) => t.name === "web_search")!;
    expect(JSON.stringify(await tool.execute("c1", { query: "x" }))).toContain("检索失败：exa 全部 key 失败");
  });
});

describe("meta-chat 线程存储", () => {
  it("建/追加/读回/归档/删除，落盘到 workshop/", async () => {
    const store = await makeStore();
    const threads = new WorkshopThreads(store);
    const a = await threads.create("世界观");
    const b = await threads.create("立绘");
    await threads.append(a.id, { role: "user", text: "你好", at: Date.now() });
    await threads.append(a.id, { role: "assistant", text: "在", at: Date.now() + 1 });

    expect(await threads.messages(a.id)).toHaveLength(2);
    expect(await threads.lastActive()).toBe(a.id);
    expect(existsSync(join(store.dir, "workshop", `${a.id}.json`))).toBe(true);

    await threads.update(b.id, { archived: true });
    // 归档沉底：未归档的排前面
    expect((await threads.list())[0]!.id).toBe(a.id);

    await threads.remove(a.id);
    expect(await threads.messages(a.id)).toEqual([]);
    expect((await threads.list()).map((t) => t.id)).toEqual([b.id]);
  });

  it("损坏的线程文件按空对话处理（不拖垮工坊面板）", async () => {
    const store = await makeStore();
    const threads = new WorkshopThreads(store);
    const t = await threads.create("坏的");
    await writeFile(join(store.dir, "workshop", `${t.id}.json`), "{不是 JSON");
    expect(await threads.messages(t.id)).toEqual([]);
  });
});

describe("WorkshopSession：一轮对话", () => {
  /** 造一个 WorkshopSession，存档读接口接同一个剧目目录（测试里树都在 store.dir 下）。 */
  function makeSession(
    store: PlayStore,
    extra: {
      streamFn: ReturnType<typeof createFakeStreamFn>;
      emit: (msg: ServerMessage) => void;
      onFilesChanged?: () => void;
    },
  ): WorkshopSession {
    return new WorkshopSession({
      playId: "test",
      store,
      streamFn: extra.streamFn,
      model: {} as never,
      getApiKey: () => "test-key",
      emit: extra.emit,
      onFilesChanged: extra.onFilesChanged ?? (() => {}),
      saves: new PlaySaves(store.dir),
      saveStore: (saveId) => new PlayStore(store.dir, saveId),
    });
  }

  it("新建线程 → 落消息 → 广播 chunk/done/threads", async () => {
    const store = await makeStore();
    const emitted: ServerMessage[] = [];
    const session = makeSession(store, {
      streamFn: createFakeStreamFn([{ text: "先写个 premise 吧。" }]),
      emit: (msg) => emitted.push(msg),
    });
    await session.chat("我想要一个赛博朋克侦探故事");
    await session.snapshot();

    const types = emitted.map((m) => m.type);
    expect(types).toContain("workshop_chunk");
    expect(types).toContain("workshop_done");
    expect(types).toContain("workshop_threads");
    expect(types).toContain("workshop_history");
    const done = emitted.find((m) => m.type === "workshop_done") as { text: string } | undefined;
    expect(done?.text).toBe("先写个 premise 吧。");

    const history = emitted.filter((m) => m.type === "workshop_history").at(-1) as
      | { messages: { role: string; text: string }[] }
      | undefined;
    expect(history?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(history?.messages[1]!.text).toBe("先写个 premise 吧。");
  });

  it("模型报错/空回复上报 workshop_error，不落一条空回复", async () => {
    const store = await makeStore();
    const emitted: ServerMessage[] = [];
    const session = makeSession(store, {
      // 假流返回空文本：工坊请求失败必须显式报错，不能静默追加一条空气泡
      streamFn: createFakeStreamFn([{ text: "" }]),
      emit: (msg) => emitted.push(msg),
    });
    await session.chat("在吗");
    const error = emitted.find((m) => m.type === "workshop_error") as { message: string } | undefined;
    expect(error?.message).toContain("空内容");
    expect(emitted.some((m) => m.type === "workshop_done")).toBe(false);
    const history = emitted.filter((m) => m.type === "workshop_history").at(-1) as
      | { messages: { role: string }[] }
      | undefined;
    expect(history?.messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("半途失败：已出的图必须落进线程历史，不能只闪一下就被 history 冲掉", async () => {
    const store = await makeStore();
    const emitted: ServerMessage[] = [];
    const png = await sharp({
      create: { width: 1376, height: 768, channels: 3, background: "#3366aa" },
    })
      .png()
      .toBuffer();
    const session = new WorkshopSession({
      store,
      playId: "test",
      playAssets: new PlayAssets("test", {
        store,
        files: new PlayFiles(store),
        backend: { generate: async () => ({ data: png, mimeType: "image/png" }) },
        limiter: new Limiter(1),
        onWrite: () => {},
      }),
      // 第一轮：先出一张背景图；下一轮回空内容触发错误路径
      streamFn: createFakeStreamFn([
        { text: "", toolCalls: [{ name: "generate_image", args: { kind: "background", name: "rooftop", prompt: "黄昏天台" } }] },
        { text: "" },
      ]),
      model: {} as never,
      getApiKey: () => "test-key",
      emit: (msg) => emitted.push(msg),
      onFilesChanged: () => {},
    });
    await session.chat("出个天台");

    const error = emitted.find((m) => m.type === "workshop_error") as { images?: unknown[] } | undefined;
    expect(error?.images).toHaveLength(1);
    // 关键：图进了 history，重连/刷新后还在。不这么做的话前端一收到 history 就清空 pendingAssets
    const history = emitted.filter((m) => m.type === "workshop_history").at(-1) as
      | { messages: { role: string; images?: unknown[] }[] }
      | undefined;
    expect(history?.messages.at(-1)?.images).toHaveLength(1);
  });

  it("人手改动（REST）不产生撤销记录，但同样触发 runtime 重建", async () => {
    const store = await makeStore();
    const emitted: ServerMessage[] = [];
    let reloads = 0;
    const session = makeSession(store, {
      streamFn: createFakeStreamFn([{ text: "x" }]),
      emit: (msg) => emitted.push(msg),
      onFilesChanged: () => {
        reloads += 1;
      },
    });
    await session.writeFile("memory/index/lore/手工.md", "# 手工\n");
    expect(emitted.filter((m) => m.type === "workshop_write")).toEqual([]);
    expect(reloads).toBe(1);

    await session.removeFile("memory/index/lore/手工.md");
    expect(reloads).toBe(2);
    expect(existsSync(join(store.dir, "memory/index/lore/手工.md"))).toBe(false);
    await expect(session.removeFile("play.json")).rejects.toThrow("不可删除");
  });

  /** 造一条已攒了 12 条消息（6 轮）的长线程：每条 60 字 = 15 token 估算。 */
  async function seedLongThread(store: PlayStore): Promise<string> {
    const threads = new WorkshopThreads(store);
    const thread = await threads.create("世界观");
    for (let i = 0; i < 6; i += 1) {
      await threads.append(thread.id, { role: "user", text: `第${i}问`.repeat(30), at: Date.now() });
      await threads.append(thread.id, { role: "assistant", text: `第${i}答`.repeat(30), at: Date.now() });
    }
    return thread.id;
  }

  describe("线程压缩", () => {
    /** 开跑前会先发一次摘要请求、再发本轮对话；contexts 按顺序记下每次请求体。 */
    function compactingSession(
      store: PlayStore,
      responses: { text: string }[],
      compaction: { contextWindow: number; triggerRatio: number; keepRecentTokens: number },
      failFirstCall = false,
    ): { session: WorkshopSession; contexts: string[]; emitted: ServerMessage[] } {
      const contexts: string[] = [];
      const emitted: ServerMessage[] = [];
      const base = createFakeStreamFn(responses);
      const session = new WorkshopSession({
        playId: "test",
        store,
        model: {} as never,
        getApiKey: () => "test-key",
        streamFn: (model, context, options) => {
          contexts.push(JSON.stringify(context));
          // 摘要走的是第一次请求：把它打掉就是「摘要生成失败」这条路径
          if (failFirstCall && contexts.length === 1) throw new Error("网关炸了");
          return base(model, context, options);
        },
        emit: (msg) => emitted.push(msg),
        onFilesChanged: () => {},
        saves: new PlaySaves(store.dir),
        saveStore: (saveId) => new PlayStore(store.dir, saveId),
        compaction,
      });
      return { session, contexts, emitted };
    }

    // 预算 = 400×0.6 = 240 token；工坊 A 区本身就过千，所以这条必然超阈值（测的是压缩路径）
    const TIGHT = { contextWindow: 400, triggerRatio: 0.6, keepRecentTokens: 60 };

    it("超阈值：早期轮次退出上下文，摘要进 A 区，原文一条不删", async () => {
      const store = await makeStore();
      const threadId = await seedLongThread(store);
      const { session, contexts, emitted } = compactingSession(
        store,
        [
          { text: "定了赛博朋克侦探题材\n\n## 已确定\n- 主角是记不住人脸的女高中生" },
          { text: "接着写角色卡。" },
        ],
        TIGHT,
      );
      await session.chat("继续搭", threadId);

      // 第一次请求是摘要（看得见 head），第二次是本轮对话（head 已不在）
      expect(contexts).toHaveLength(2);
      expect(contexts[0]).toContain("第0问");
      expect(contexts[1]).not.toContain("第0问");
      // 保留 60 token ≈ 4 条，预算落点是 assistant，顺延到下一条 user（下标 10）→ 保留 2 条
      expect(contexts[1]).toContain("第5问");
      expect(contexts[1]).toContain("本会话已确定");

      const thread = (await new WorkshopThreads(store).list()).find((t) => t.id === threadId);
      expect(thread?.compaction?.cutAt).toBe(10);
      expect(thread?.summary).toBe("定了赛博朋克侦探题材");
      // 原文仍在：12 条历史一条不少，还多了这一轮
      expect((await new WorkshopThreads(store).messages(threadId)).length).toBe(14);
      const history = emitted.filter((m) => m.type === "workshop_history").at(-1) as
        | { compaction: { cutAt: number } | null; messages: unknown[] }
        | undefined;
      expect(history?.compaction?.cutAt).toBe(10);
      expect(history?.messages).toHaveLength(14);
    });

    it("摘要请求失败：只告警不压缩，本轮照常开跑", async () => {
      const store = await makeStore();
      const threadId = await seedLongThread(store);
      const { session, contexts, emitted } = compactingSession(store, [{ text: "接着写。" }], TIGHT, true);
      await session.chat("继续搭", threadId);

      expect(emitted.some((m) => m.type === "workshop_done")).toBe(true);
      expect(contexts[0]).toContain("第0问"); // 没压掉，本轮仍带着完整历史
      const thread = (await new WorkshopThreads(store).list()).find((t) => t.id === threadId);
      expect(thread?.compaction ?? null).toBeNull();
    });

    it("未超阈值：不压缩", async () => {
      const store = await makeStore();
      const threadId = await seedLongThread(store);
      const { session, contexts } = compactingSession(store, [{ text: "接着写。" }], {
        contextWindow: 10_000_000,
        triggerRatio: 0.6,
        keepRecentTokens: 60,
      });
      await session.chat("继续搭", threadId);
      expect(contexts).toHaveLength(1);
      const thread = (await new WorkshopThreads(store).list()).find((t) => t.id === threadId);
      expect(thread?.compaction ?? null).toBeNull();
    });
  });

  it("一轮内多次写盘只触发一次 runtime 重建", async () => {
    const store = await makeStore();
    let reloads = 0;
    const session = makeSession(store, {
      streamFn: createFakeStreamFn([
        {
          text: "写好两处设定。",
          toolCalls: [
            { name: "write", args: { path: "memory/always/premise.md", content: "# 前提\n改了。\n" } },
            { name: "write", args: { path: "memory/index/lore/新设定.md", content: "# 新设定\n" } },
          ],
        },
        { text: "写好两处设定。" },
      ]),
      emit: () => {},
      onFilesChanged: () => {
        reloads += 1;
      },
    });
    await session.chat("补两处设定");
    expect(reloads).toBe(1);
    expect(existsSync(join(store.dir, "memory/index/lore/新设定.md"))).toBe(true);
  });

  it("bash 写坏 play.json：跳过重建并把原因摆到对话流里，不是静默不刷新", async () => {
    const store = await makeStore();
    const emitted: ServerMessage[] = [];
    let reloads = 0;
    const session = new WorkshopSession({
      playId: "test",
      store,
      streamFn: createFakeStreamFn([
        {
          text: "顺手改了一下。",
          toolCalls: [{ name: "bash", args: { command: "echo '{ broken' > play.json" } }],
        },
        { text: "顺手改了一下。" },
      ]),
      model: {} as never,
      getApiKey: () => "test-key",
      emit: (msg) => emitted.push(msg),
      onFilesChanged: () => {
        reloads += 1;
      },
      saves: new PlaySaves(store.dir),
      saveStore: (saveId) => new PlayStore(store.dir, saveId),
      // bash 默认关，这里显式勾上——测的就是勾上之后那条没有校验的路
      agents: { tools: [...defaultToolsFor("workshop"), "bash"] },
    });
    await session.chat("把 play.json 改坏");

    expect(reloads).toBe(0); // 带着坏配置去 rebuild 只会抛在 void 的 promise 里
    const error = emitted.filter((m) => m.type === "workshop_error").at(-1) as { message: string } | undefined;
    expect(error?.message).toContain("play.json");
    expect(error?.message).toContain("跳过这次的运行时重建");
  });
});

describe("whenIdle：工坊热改等轮边界", () => {
  it("演出进行中不兑现，轮收束后立即兑现", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let call = 0;
    const base = createFakeStreamFn([{ text: BEAT_1, beatDone: true }, { text: BEAT_2, beatDone: true }]);
    const tree = new LineageTree();
    const orchestrator = new PlaywrightOrchestrator({
      // 第一轮挂在门上：模拟「正在演戏」的那段时间窗
      streamFn: (model, context, options) => {
        call += 1;
        if (call > 1) return base(model, context, options);
        const stream = createAssistantMessageEventStream();
        void gate.then(() => {
          const inner = base(model, context, options);
          void (async () => {
            for await (const event of inner) stream.push(event);
          })();
        });
        return stream;
      },
      model: {} as never,
      getApiKey: () => "test-key",
      play: PLAY,
      memory: new PlayMemory(),
      tree,
      engine: { ...PLAY.initialState },
      scene: PLAY.initialScene,
      onServerMessage: () => {},
      persist: () => {},
    });

    const beat = orchestrator.playerAction({ kind: "continue" });
    await new Promise((r) => setTimeout(r, 20));
    let idle = false;
    void orchestrator.whenIdle().then(() => {
      idle = true;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(idle).toBe(false);
    release();
    await beat;
    await orchestrator.whenIdle();
    expect(idle).toBe(true);
    orchestrator.dispose();
  });
});

describe("工坊：写作参数与创作口径的交接，以及自定义提示词", () => {
  const ctx = (over: Partial<WorkshopPromptContext> = {}): WorkshopPromptContext => ({
    title: "测试剧目",
    files: "- play.json",
    readiness: { ready: true, premise: true, characterSprites: false, background: false, saves: 0 },
    craft: DEFAULT_CRAFT,
    can: { image: true, search: false, library: false, voice: false, shell: false, nsfw: true },
    ...over,
  });

  it("教搭台助手：节奏与素材来源走 set_craft，craft.md 只留能拿话说的", async () => {
    const prompt = await buildWorkshopPrompt(ctx());
    expect(prompt).toContain("set_craft");
    expect(prompt).toContain("文风与禁忌");
    // 现值摆在提示词里，工坊回答「现在是什么节奏」不用去读 play.json
    expect(prompt).toContain("每轮篇幅：中等");
    expect(prompt).toContain("素材来源：背景 资源库优先");
    // 别再让它把节奏写进 craft.md——写两处必然打架
    expect(prompt).toContain("不要写在这里");
  });

  it("写作参数现值跟着 play.json 走，报的是生效值不是默认值", async () => {
    const prompt = await buildWorkshopPrompt(ctx({ craft: resolveCraft({ beatLength: "short", assets: { cg: "off" } }) }));
    expect(prompt).toContain("每轮篇幅：短");
    expect(prompt).toContain("插图 不用插图");
  });

  it("剧本语言设死了就告诉工坊用它写设定；不设则不注入", async () => {
    expect(await buildWorkshopPrompt(ctx())).not.toContain("本剧的剧本语言是");
    const ja = await buildWorkshopPrompt(ctx({ scriptLanguage: "ja" }));
    expect(ja).toContain("本剧的剧本语言是");
    expect(ja).toContain("日本語 / 日语");
  });

  it("出图审批默认先问，设成 auto 就改成免审批", async () => {
    expect(await buildWorkshopPrompt(ctx())).toContain("用户没点头之前一张都不要开跑");
    const auto = await buildWorkshopPrompt(ctx({ imageApproval: "auto" }));
    expect(auto).toContain("本剧目免审批出图");
    expect(auto).not.toContain("用户没点头之前一张都不要开跑");
  });

  it("自定义提示词原样追加在固定段之后", async () => {
    const prompt = await buildWorkshopPrompt(ctx({ customPrompt: "这部作品不说日语。" }));
    expect(prompt).toContain("# 本剧目的补充要求");
    expect(prompt).toContain("这部作品不说日语。");
    expect(prompt.indexOf("本剧目的补充要求")).toBeGreaterThan(prompt.indexOf("# 当前状态"));
  });

  it("没配自定义段时一点痕迹都不留", async () => {
    const prompt = await buildWorkshopPrompt(ctx());
    expect(prompt).not.toContain("# 本剧目的补充要求");
    expect(await buildWorkshopPrompt(ctx({ customPrompt: "   " }))).not.toContain("# 本剧目的补充要求");
  });
});
