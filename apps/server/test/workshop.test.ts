import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMessage } from "@stage-ai/core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { PlayFiles } from "../src/playFiles.js";
import { PlayStore } from "../src/store.js";
import { WorkshopThreads } from "../src/workshopThreads.js";
import { WorkshopSession } from "../src/workshopSession.js";
import { createWorkshopTools, deriveThreadTitle, renderReadiness } from "../src/workshop.js";
import { createFakeStreamFn, BEAT_1, BEAT_2, PLAY } from "./helpers.js";
import { PlaywrightOrchestrator } from "../src/orchestrator.js";
import { LineageTree } from "@stage-ai/core";
import { PlayMemory } from "../src/memory.js";

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
    // 素材可读不可写
    expect(await files.read("assets/backgrounds/corridor.png")).toBe("png");
    await expect(files.write("assets/backgrounds/corridor.png", "x")).rejects.toThrow();
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
});

describe("工坊工具", () => {
  it("write_file 校验 play.json：坏结构不落盘并把错误回给模型", async () => {
    const store = await makeStore();
    const writes: string[] = [];
    const tools = createWorkshopTools({
      files: new PlayFiles(store),
      store,
      onWrite: (w) => writes.push(w.path),
    });
    const writeFileTool = tools.find((t) => t.name === "write_file")!;

    const bad = await writeFileTool.execute("c1", { path: "play.json", content: '{"id":"test"}' }, undefined as never);
    expect(JSON.stringify(bad)).toContain("校验失败");
    expect(writes).toEqual([]);
    expect(JSON.parse(await readFile(join(store.dir, "play.json"), "utf8")).title).toBe("测试剧目");

    const good = await writeFileTool.execute(
      "c2",
      { path: "memory/always/premise.md", content: "# 新前提\n改了。\n" },
      undefined as never,
    );
    expect(JSON.stringify(good)).toContain("已写入");
    expect(writes).toEqual(["memory/always/premise.md"]);
  });

  it("read_file / list_files 返回可读文本，越界返回失败提示而非抛错", async () => {
    const store = await makeStore();
    const tools = createWorkshopTools({ files: new PlayFiles(store), store, onWrite: () => {} });
    const readFileTool = tools.find((t) => t.name === "read_file")!;
    expect(JSON.stringify(await readFileTool.execute("c1", { path: "play.json" }, undefined as never))).toContain(
      "测试剧目",
    );
    expect(JSON.stringify(await readFileTool.execute("c2", { path: "session.json" }, undefined as never))).toContain(
      "读取失败",
    );
  });

  it("就绪门渲染缺项提示", () => {
    const text = renderReadiness({
      ready: false,
      premise: true,
      characterSprites: false,
      background: false,
      hasSession: false,
    });
    expect(text).toContain("未就绪");
    expect(text).toContain("角色立绘映射：✗");
    expect(text).toContain("背景图：✗");
  });

  it("线程标题取首条消息前 20 字", () => {
    expect(deriveThreadTitle("  我想要一个赛博朋克侦探故事  ")).toBe("我想要一个赛博朋克侦探故事");
    expect(deriveThreadTitle("一".repeat(30))).toBe(`${"一".repeat(20)}…`);
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
  it("新建线程 → 落消息 → 广播 chunk/done/threads", async () => {
    const store = await makeStore();
    const emitted: ServerMessage[] = [];
    const session = new WorkshopSession({
      store,
      streamFn: createFakeStreamFn([{ text: "先写个 premise 吧。" }]),
      model: {} as never,
      getApiKey: () => "test-key",
      emit: (msg) => emitted.push(msg),
      onFilesChanged: () => {},
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
    const session = new WorkshopSession({
      store,
      // 假流返回空文本：工坊请求失败必须显式报错，不能静默追加一条空气泡
      streamFn: createFakeStreamFn([{ text: "" }]),
      model: {} as never,
      getApiKey: () => "test-key",
      emit: (msg) => emitted.push(msg),
      onFilesChanged: () => {},
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

  it("人手改动（REST）不产生撤销记录，但同样触发 runtime 重建", async () => {
    const store = await makeStore();
    const emitted: ServerMessage[] = [];
    let reloads = 0;
    const session = new WorkshopSession({
      store,
      streamFn: createFakeStreamFn([{ text: "x" }]),
      model: {} as never,
      getApiKey: () => "test-key",
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

  it("一轮内多次写盘只触发一次 runtime 重建", async () => {
    const store = await makeStore();
    let reloads = 0;
    const session = new WorkshopSession({
      store,
      streamFn: createFakeStreamFn([
        {
          text: "写好两处设定。",
          toolCalls: [
            { name: "write_file", args: { path: "memory/always/premise.md", content: "# 前提\n改了。\n" } },
            { name: "write_file", args: { path: "memory/index/lore/新设定.md", content: "# 新设定\n" } },
          ],
        },
        { text: "写好两处设定。" },
      ]),
      model: {} as never,
      getApiKey: () => "test-key",
      emit: () => {},
      onFilesChanged: () => {
        reloads += 1;
      },
    });
    await session.chat("补两处设定");
    expect(reloads).toBe(1);
    expect(existsSync(join(store.dir, "memory/index/lore/新设定.md"))).toBe(true);
  });
});

describe("whenIdle：工坊热改等节拍边界", () => {
  it("演出进行中不兑现，拍收束后立即兑现", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let call = 0;
    const base = createFakeStreamFn([{ text: BEAT_1, beatDone: true }, { text: BEAT_2, beatDone: true }]);
    const tree = new LineageTree();
    const orchestrator = new PlaywrightOrchestrator({
      // 第一拍挂在门上：模拟「正在演戏」的那段时间窗
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
