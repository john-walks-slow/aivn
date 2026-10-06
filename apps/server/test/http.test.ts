import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CgEntry } from "@aivn/core";
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

  it("GET /api/agents/capabilities 返回能力目录（设置页渲染开关用，含 locked / available）", async () => {
    const res = new FakeRes();
    await handleHttp(
      { url: "/api/agents/capabilities", method: "GET" } as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new PlayLibrary("/tmp"),
      {
        capabilities: () => ({
          capabilities: [
            {
              id: "stage",
              label: "轮与状态",
              desc: "结束本轮、提议状态更新——演出本身的收束口，始终开启。",
              group: "show",
              groupLabel: "演出",
              locked: true,
              available: true,
            },
          ],
          defaults: { playwriter: ["memory"], workshop: ["files"] },
        }),
      } as unknown as PlayHouse,
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      capabilities: [
        {
          id: "stage",
          label: "轮与状态",
          desc: "结束本轮、提议状态更新——演出本身的收束口，始终开启。",
          group: "show",
          groupLabel: "演出",
          locked: true,
          available: true,
        },
      ],
      defaults: { playwriter: ["memory"], workshop: ["files"] },
    });
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
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

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

  /** 往出图台账里写条目并落文件；磁盘是权威，缺文件的条目会被跳过。 */
  const writeLedger = async (
    entries: Record<string, { kind: "cg" | "background"; path: string; prompt: string }>,
  ): Promise<void> => {
    const table: Record<string, unknown> = {};
    for (const [id, e] of Object.entries(entries)) {
      await mkdir(join(root, "p1", ...e.path.split("/").slice(0, -1)), { recursive: true });
      await writeFile(join(root, "p1", e.path), "x");
      table[id] = { ...e, at: "2026-10-01T10:00:00.000Z" };
    }
    await writeFile(join(root, "p1", "assets", "generated.json"), JSON.stringify(table));
  };

  it("静态素材带素材表描述，站内生成的图带 prompt", async () => {
    await writeFile(join(root, "p1", "assets", "cg", "cg_rooftop.jpg"), "x");
    await writeFile(
      join(root, "p1", "assets", "manifest.json"),
      JSON.stringify({ cg_rooftop: "晚霞天台的告白" }),
    );
    await writeLedger({ cg_confession: { kind: "cg", path: "assets/cg/cg_confession.jpg", prompt: "two students at dusk" } });

    const { status, playhouseTouched, body } = await get();
    expect(status).toBe(200);
    expect(playhouseTouched).toBe(false);
    expect(body.entries).toEqual([
      {
        id: "cg_confession",
        url: "/plays/p1/assets/cg/cg_confession.jpg",
        origin: "asset",
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
    await writeLedger({ cg_confession: { kind: "cg", path: "assets/cg/cg_confession.png", prompt: "two students at dusk" } });
    const { body } = await get();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      origin: "asset",
      url: "/plays/p1/assets/cg/cg_confession.png",
      prompt: "two students at dusk",
    });
  });

  it("assets/generated.json 里记的出图 prompt 进 CG 台账（工坊 generate_image 那条路）", async () => {
    await writeFile(join(root, "p1", "assets", "cg", "cg_confession.png"), "x");
    await writeFile(
      join(root, "p1", "assets", "generated.json"),
      JSON.stringify({
        cg_confession: {
          id: "cg_confession",
          kind: "cg",
          path: "assets/cg/cg_confession.png",
          prompt: "two students at dusk, cinematic",
          at: "2026-10-01T10:00:00.000Z",
        },
      }),
    );
    const { body } = await get();
    expect(body.entries[0]).toMatchObject({
      id: "cg_confession",
      origin: "asset",
      prompt: "two students at dusk, cinematic",
    });
  });

  it("台账里图已删的条目不算数（磁盘是权威）", async () => {
    await writeFile(
      join(root, "p1", "assets", "generated.json"),
      JSON.stringify({
        cg_gone: { id: "cg_gone", kind: "cg", path: "assets/cg/cg_gone.png", prompt: "p", at: "2026-10-01T10:00:00.000Z" },
      }),
    );
    expect((await get()).body.entries).toEqual([]);
  });

  it("背景类的生成图不进 CG 页", async () => {
    await writeLedger({ bg_classroom: { kind: "background", path: "assets/backgrounds/bg_classroom.jpg", prompt: "p" } });
    expect((await get()).body.entries).toEqual([]);
  });

  it("台账里的文件已被删掉 → 那条不算数（磁盘是权威）", async () => {
    await writeFile(
      join(root, "p1", "assets", "generated.json"),
      JSON.stringify({ cg_gone: { id: "cg_gone", kind: "cg", path: "assets/cg/gone.jpg", prompt: "p", at: "x" } }),
    );
    expect((await get()).body.entries).toEqual([]);
  });

  it("什么都没有时返回空表，不报错", async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.entries).toEqual([]);
  });
});

describe("POST /api/lan/open-firewall：只认本机，且只在装好的 Windows 版里有意义", () => {
  const post = async (remoteAddress: string): Promise<FakeRes> => {
    const res = new FakeRes();
    await handleHttp(
      {
        url: "/api/lan/open-firewall",
        method: "POST",
        socket: { remoteAddress },
      } as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new PlayLibrary("/tmp"),
      {} as PlayHouse,
    );
    return res;
  };

  it("局域网来源直接 403（不允许远程把 UAC 弹窗糊到用户脸上）", async () => {
    expect((await post("192.168.1.23")).statusCode).toBe(403);
  });

  it("本机来源在开发态如实说这条不适用（501），不假装成功", async () => {
    const res = await post("::ffff:127.0.0.1");
    expect(res.statusCode).toBe(501);
    expect(res.payload).toContain("Windows");
  });
});

describe("GET /api/voices：按条件现拉窗口", () => {
  const call = async (query: string, voices?: unknown): Promise<FakeRes> => {
    const res = new FakeRes();
    await handleHttp(
      { url: `/api/voices${query}`, method: "GET" } as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new PlayLibrary("/tmp"),
      {} as PlayHouse,
      undefined,
      undefined,
      voices as never,
    );
    return res;
  };

  it("language/tag（可重复）/q 解析成窗口查询，refresh 透传", async () => {
    const seen: { query?: unknown; refresh?: boolean }[] = [];
    const res = await call(
      "?language=ja&tag=anime&tag=character-voice&q=%E9%9B%B7%E5%A7%86&refresh=1",
      {
        list: async (query: unknown, refresh?: boolean) => {
          seen.push({ query, refresh });
          return { entries: [], fetchedAt: 0, totalAvailable: 0, stale: false };
        },
      },
    );
    expect(res.statusCode).toBe(200);
    expect(seen[0]?.query).toEqual({ language: "ja", tags: ["anime", "character-voice"], title: "雷姆" });
    expect(seen[0]?.refresh).toBe(true);
  });

  it("非法语言码、超量标签、超长关键词都 400，不放行到上游", async () => {
    const seen: unknown[] = [];
    const voices = {
      list: async (query: unknown) => {
        seen.push(query);
        return { entries: [], fetchedAt: 0, totalAvailable: 0, stale: false };
      },
    };
    expect((await call("?language=ja1", voices)).statusCode).toBe(400);
    expect((await call("?tag=a&tag=b&tag=c&tag=d&tag=e", voices)).statusCode).toBe(400);
    expect((await call(`?q=${"x".repeat(61)}`, voices)).statusCode).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it("没启用音色库（没配 TTS key）如实 404", async () => {
    expect((await call("", undefined)).statusCode).toBe(404);
  });
});

describe("PUT /api/plays/:id/assets/sprite：素材页写立绘呈现声明", () => {
  let root: string;
  let library: PlayLibrary;
  let declared: unknown[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stage-http-sprite-"));
    library = new PlayLibrary(root);
    await library.createEmpty("p1", "黄昏");
    declared = [];
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const put = async (body: unknown): Promise<FakeRes> => {
    const res = new FakeRes();
    const house = {
      declareSpriteMeta: async (_playId: string, decl: unknown) => {
        declared.push(decl);
      },
    } as unknown as PlayHouse;
    await handleHttp(
      {
        url: "/api/plays/p1/assets/sprite",
        method: "PUT",
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify(body), "utf8");
        },
      } as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      library,
      house,
    );
    return res;
  };

  it("白名单内的取值原样落给素材表（null = 摘掉那一格）", async () => {
    const res = await put({ spriteId: "mecha_01", framing: "square", stature: "huge", title: "试验机·壹式" });
    expect(res.statusCode).toBe(200);
    expect(declared).toEqual([{ spriteId: "mecha_01", variant: null, framing: "square", stature: "huge", title: "试验机·壹式" }]);
    expect((await put({ spriteId: "mecha_01", framing: null })).statusCode).toBe(200);
    expect(declared[1]).toEqual({ spriteId: "mecha_01", variant: null, framing: null });
  });

  it("取值不在白名单里就直接 400，不许先回 400 再往下写一次响应", async () => {
    const res = await put({ spriteId: "mecha_01", framing: "bust" });
    expect(res.statusCode).toBe(400);
    expect(res.payload).toContain("取景");
    // 校验不过就一个字节都不该落：落盘那一步根本没被调到
    expect(declared).toEqual([]);
  });
});

describe("GET /plays/:id/drafts/<draftId>/<file>：生图草稿预览", () => {
  let root: string;
  let library: PlayLibrary;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stage-http-drafts-"));
    library = new PlayLibrary(root);
    await library.createEmpty("p1", "黄昏");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function get(url: string): Promise<FakeRes> {
    const res = new FakeRes();
    await handleHttp(
      { url, method: "GET" } as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      library,
      {} as PlayHouse,
    );
    return res;
  }

  it("把草稿目录里的成图送出去（出图与入库解耦后，候选预览靠这条）", async () => {
    const dir = join(root, "p1", "media-cache", "drafts", "d-1");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "image.png"), Buffer.from("PNGDATA"));

    const res = await get("/plays/p1/drafts/d-1/image.png");
    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("PNGDATA");
  });

  it("草稿不存在时 404，不越出草稿目录", async () => {
    expect((await get("/plays/p1/drafts/d-1/image.png")).statusCode).toBe(404);
    expect((await get("/plays/p1/drafts/d-1/..%2F..%2Fplay.json")).statusCode).toBe(404);
    expect((await get("/plays/p1/drafts/d-1/a/b.png")).statusCode).toBe(404);
  });
});
