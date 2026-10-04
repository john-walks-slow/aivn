import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageError, parseLaunchArgs } from "../src/cli.js";
import { workshopSkillsDirOf } from "../src/paths.js";
import { exitWhenStdinCloses, listenWithFallback } from "../src/startup.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
});

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("启动参数", () => {
  it("不给参数就是什么都不覆盖（默认值由 loadBootstrap 决定）", () => {
    expect(parseLaunchArgs([])).toEqual({ help: false, selftest: false, exitOnStdinClose: false });
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
      exitOnStdinClose: false,
      port: 9000,
      host: "127.0.0.1",
      dataDir: "/tmp/x",
      open: false,
    });
    expect(parseLaunchArgs(["-p", "1", "--open"]).open).toBe(true);
    expect(parseLaunchArgs(["-h"]).help).toBe(true);
    expect(parseLaunchArgs(["--selftest"]).selftest).toBe(true);
    expect(parseLaunchArgs(["--exit-on-stdin-close"]).exitOnStdinClose).toBe(true);
  });

  it("端口不合法或缺值直接报错，不静默退回默认端口", () => {
    expect(parseLaunchArgs(["--port", "0"]).port).toBe(0); // 0 = 自动挑一个空闲端口
    expect(() => parseLaunchArgs(["--port", "-1"])).toThrow(UsageError);
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

  it("传 0 就是交给系统挑，返回值必须是系统挑的那个（不是入参 0）", async () => {
    const server = createServer();
    servers.push(server);
    const port = await listenWithFallback(server, 0, "127.0.0.1");
    expect(port).toBe((server.address() as { port: number }).port);
    expect(port).toBeGreaterThan(0);
  });
});

describe("桌面壳的回收信号", () => {
  it("stdin 读到 EOF 就回调（壳子关掉管道 = 它没了）", async () => {
    const stdin = new PassThrough();
    const closed = vi.fn();
    exitWhenStdinCloses(stdin, closed);
    expect(closed).not.toHaveBeenCalled(); // 壳子还活着时不能误伤
    stdin.end();
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
  });

  it("不停在 paused：只挂监听不 resume 的话 EOF 事件永远不来", () => {
    const stdin = new PassThrough();
    exitWhenStdinCloses(stdin, () => {});
    expect(stdin.isPaused()).toBe(false);
  });
});

describe("工坊技能库路径", () => {
  it("开发态取 apps/server/skills，打包态从快照根接同一段路径", () => {
    const metaUrl = "file:///tmp/repo/apps/server/dist/skills.js";
    expect(workshopSkillsDirOf(metaUrl, false)).toBe("/tmp/repo/apps/server/skills");
    expect(workshopSkillsDirOf("file:///snapshot/aivn/dist/index.cjs", true)).toBe(
      "/snapshot/aivn/apps/server/skills",
    );
  });
});
