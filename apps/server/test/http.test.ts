import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CgEntry } from "@stage-ai/core";
import type { ManifestEntry } from "../src/imageAssets.js";
import { PlayLibrary } from "../src/store.js";
import { handleHttp } from "../src/http.js";
import type { PlayHouse } from "../src/playhouse.js";

/** 只认 writeHead/end 的最小 res：REST 用例只断言状态码与 JSON 载荷。 */
class FakeRes {
  statusCode = 0;
  payload = "";
  writeHead(code: number): this {
    this.statusCode = code;
    return this;
  }
  end(data?: string | Buffer): this {
    this.payload = data ? data.toString() : "";
    return this;
  }
}

describe("GET /api/plays/:id 的前提字段", () => {
  let root: string;
  let library: PlayLibrary;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stage-http-"));
    library = new PlayLibrary(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("响应带顶层 premise 键（play.json 里已经没有这个字段了）", async () => {
    await library.createEmpty("p1", "黄昏");
    await writeFile(
      join(root, "p1", "memory", "always", "premise.md"),
      "初夏的放学后。\n",
      "utf8",
    );

    const res = new FakeRes();
    await handleHttp(
      { url: "/api/plays/p1", method: "GET" } as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      library,
      {} as PlayHouse,
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { premise?: unknown; play?: Record<string, unknown> };
    // 键名是手写契约（web 的 PlayDetail 是手抄的），拼错类型检查抓不到，这里钉住
    expect(body.premise).toBe("初夏的放学后。\n");
    expect(body.play).not.toHaveProperty("premise");
  });
});

describe("Agent 设置页的两个目录", () => {
  it("GET /api/agents/models 透出网关模型清单与默认模型（refresh 透传）", async () => {
    const seen: boolean[] = [];
    const res = new FakeRes();
    await handleHttp(
      { url: "/api/agents/models?refresh=1", method: "GET" } as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new PlayLibrary("/tmp"),
      {
        gatewayModels: async (refresh?: boolean) => {
          seen.push(refresh === true);
          return { models: [{ id: "gpt-5", name: "GPT-5" }], defaultModel: "gpt-5" };
        },
      } as unknown as PlayHouse,
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ models: [{ id: "gpt-5", name: "GPT-5" }], defaultModel: "gpt-5" });
    expect(seen).toEqual([true]);
  });

  it("GET /api/agents/models 网关读不到就报错，不悄悄退回默认模型", async () => {
    const res = new FakeRes();
    await handleHttp(
      { url: "/api/agents/models", method: "GET" } as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new PlayLibrary("/tmp"),
      {
        gatewayModels: async () => {
          throw new Error("网关模型清单读取失败 HTTP 502");
        },
      } as unknown as PlayHouse,
    );
    expect(res.statusCode).toBe(400);
    expect(res.payload).toContain("网关模型清单读取失败");
  });

  it("GET /api/agents/tools 返回工具目录（设置页渲染开关用）", async () => {
    const res = new FakeRes();
    await handleHttp(
      { url: "/api/agents/tools", method: "GET" } as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new PlayLibrary("/tmp"),
      {
        tools: () => [{ id: "beat_done", label: "结束本轮", group: "beat", roles: ["playwriter"] }],
      } as unknown as PlayHouse,
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).tools).toEqual([
      { id: "beat_done", label: "结束本轮", group: "beat", roles: ["playwriter"] },
    ]);
  });
});

describe("GET /api/plays/:id/cg：CG 页的台账", () => {
  let root: string;
  let library: PlayLibrary;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stage-cg-"));
    library = new PlayLibrary(root);
    await library.createEmpty("p1", "黄昏");
    await mkdir(join(root, "p1", "assets", "cg"), { recursive: true });
    await mkdir(join(root, "p1", "media-cache", "img"), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** 往生图 manifest 里写条目；文件名走真实存在（磁盘是权威，缺文件的条目会被跳过）。 */
  const writeManifest = async (entries: ManifestEntry[]): Promise<void> => {
    for (const entry of entries) await writeFile(join(root, "p1", "media-cache", "img", entry.file), "x");
    await writeFile(
      join(root, "p1", "media-cache", "img", "manifest.json"),
      JSON.stringify(entries),
    );
  };

  /** 这一页只读盘，所以 PlayHouse 给一个「被调用即失败」的桩——它不该被牵动。 */
  const get = async () => {
    const res = new FakeRes();
    let playhouseTouched = false;
    await handleHttp(
      { url: "/api/plays/p1/cg", method: "GET" } as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      library,
      {
        get: async () => {
          playhouseTouched = true;
          throw new Error("CG 页不该建 runtime");
        },
      } as unknown as PlayHouse,
    );
    return { status: res.statusCode, playhouseTouched, body: JSON.parse(res.payload) as { entries: CgEntry[] } };
  };

  it("静态素材带素材表描述，站内生成的图带 prompt", async () => {
    await writeFile(join(root, "p1", "assets", "cg", "cg_rooftop.jpg"), "x");
    await writeFile(
      join(root, "p1", "assets", "manifest.json"),
      JSON.stringify({ cg_rooftop: "晚霞天台的告白" }),
    );
    await writeManifest([
      { id: "cg_confession", type: "cg", file: "a.jpg", prompt: "two students at dusk" },
    ]);

    const { status, playhouseTouched, body } = await get();
    expect(status).toBe(200);
    expect(playhouseTouched).toBe(false);
    expect(body.entries).toEqual([
      {
        id: "cg_confession",
        url: "/plays/p1/media/img/a.jpg",
        origin: "generated",
        prompt: "two students at dusk",
      },
      {
        id: "cg_rooftop",
        url: "/plays/p1/assets/cg/cg_rooftop.jpg",
        origin: "asset",
        description: "晚霞天台的告白",
      },
    ]);
  });

  it("同一 id 静态优先，但把生成记录的 prompt 捡回来", async () => {
    await writeFile(join(root, "p1", "assets", "cg", "cg_confession.png"), "x");
    await writeManifest([
      { id: "cg_confession", type: "cg", file: "a.jpg", prompt: "two students at dusk" },
    ]);
    const { body } = await get();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      origin: "asset",
      url: "/plays/p1/assets/cg/cg_confession.png",
      prompt: "two students at dusk",
    });
  });

  it("背景类的生成图不进 CG 页", async () => {
    await writeManifest([{ id: "bg_classroom", type: "bg", file: "b.jpg" }]);
    expect((await get()).body.entries).toEqual([]);
  });

  it("manifest 里的文件已被删掉 → 那条不算数（磁盘是权威）", async () => {
    await writeFile(
      join(root, "p1", "media-cache", "img", "manifest.json"),
      JSON.stringify([{ id: "cg_gone", type: "cg", file: "gone.jpg" }]),
    );
    expect((await get()).body.entries).toEqual([]);
  });

  it("什么都没有时返回空表，不报错", async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.entries).toEqual([]);
  });
});
