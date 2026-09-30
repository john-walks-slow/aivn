import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
