import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UsageError, parseLaunchArgs } from "../src/cli.js";
import { workshopSkillsDirOf } from "../src/paths.js";
import { seedDemoPlays } from "../src/seed.js";
import { listenWithFallback } from "../src/startup.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
});

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("启动参数", () => {
  it("不给参数就是什么都不覆盖（默认值由 loadBootstrap 决定）", () => {
    expect(parseLaunchArgs([])).toEqual({ help: false, selftest: false });
  });

  it("认得端口、地址、数据目录与开浏览器开关", () => {
    const options = parseLaunchArgs([
      "--port",
      "9000",
      "--host",
      "127.0.0.1",
      "--data-dir",
      "/tmp/x",
      "--no-open",
    ]);
    expect(options).toEqual({
      help: false,
      selftest: false,
      port: 9000,
      host: "127.0.0.1",
      dataDir: "/tmp/x",
      open: false,
    });
    expect(parseLaunchArgs(["-p", "1", "--open"]).open).toBe(true);
    expect(parseLaunchArgs(["-h"]).help).toBe(true);
    expect(parseLaunchArgs(["--selftest"]).selftest).toBe(true);
  });

  it("端口不合法或缺值直接报错，不静默退回默认端口", () => {
    expect(() => parseLaunchArgs(["--port", "0"])).toThrow(UsageError);
    expect(() => parseLaunchArgs(["--port", "abc"])).toThrow(UsageError);
    expect(() => parseLaunchArgs(["--port"])).toThrow(/缺一个值/);
    expect(() => parseLaunchArgs(["--nope"])).toThrow(/不认识的选项/);
  });
});

describe("端口占用时自动换口", () => {
  it("默认端口被占就往后让一位，并报告实际端口", async () => {
    const taken = createServer();
    servers.push(taken);
    await new Promise<void>((done) => taken.listen(0, "127.0.0.1", done));
    const busy = (taken.address() as { port: number }).port;

    const server = createServer();
    servers.push(server);
    const port = await listenWithFallback(server, busy, "127.0.0.1", 5);
    expect(port).not.toBe(busy);
    expect(server.listening).toBe(true);
  });
});

describe("随包样例剧目", () => {
  it("数据目录里一个剧目都没有时解开样例", () => {
    const data = tmp("aivn-data-");
    const resources = tmp("aivn-res-");
    mkdirSync(join(resources, "plays", "demo"), { recursive: true });
    writeFileSync(join(resources, "plays", "demo", "play.json"), "{}");

    expect(seedDemoPlays(data, resources)).toBe(join(data, "plays", "demo"));
    expect(seedDemoPlays(data, resources)).toBeNull(); // 第二次已经有剧目了，不再重复解
  });

  it("用户已经有自己的剧目就不动他的目录", () => {
    const data = tmp("aivn-data-");
    const resources = tmp("aivn-res-");
    mkdirSync(join(resources, "plays", "demo"), { recursive: true });
    writeFileSync(join(resources, "plays", "demo", "play.json"), "{}");
    mkdirSync(join(data, "plays", "my-play"), { recursive: true });

    expect(seedDemoPlays(data, resources)).toBeNull();
  });

  it("仓库开发态没有随包样例（没有 play.json）就什么都不做", () => {
    expect(seedDemoPlays(tmp("aivn-data-"), tmp("aivn-res-"))).toBeNull();
  });
});

describe("工坊技能库路径", () => {
  it("开发态取 apps/server/skills，打包态从快照根接同一段路径", () => {
    const metaUrl = "file:///tmp/repo/apps/server/dist/skills.js";
    expect(workshopSkillsDirOf(metaUrl, false)).toBe("/tmp/repo/apps/server/skills");
    expect(workshopSkillsDirOf("file:///snapshot/stage-ai/dist/index.cjs", true)).toBe(
      "/snapshot/stage-ai/apps/server/skills",
    );
  });
});
