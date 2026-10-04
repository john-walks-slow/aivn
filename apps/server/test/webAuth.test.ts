import { describe, expect, it } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { WebGate } from "../src/webAuth.js";
import type { ServerConfig } from "../src/config.js";
import { serveWebBundle } from "../src/webStatic.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 只喂密码的设置源：闸门只关心这一个字段。 */
function gateFor(password: string): WebGate {
  return new WebGate({ get: () => ({ password }) as ServerConfig });
}

function basic(password: string, user = "me"): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

function stubRes(): { res: Record<string, unknown>; headers: () => Record<string, string | string[]> } {
  const head: Record<string, string | string[]> = {};
  const res = {
    writeHead: (status: number, headers: Record<string, string>) => {
      head.status = String(status);
      Object.assign(head, headers);
    },
    setHeader: (key: string, value: string) => {
      head[key] = value;
    },
    end: () => {},
    headersSent: false,
  };
  return { res: res as never, headers: () => head };
}

describe("公网入口的密码闸门", () => {
  it("没配密码就全放行（本机直连不弹框）", () => {
    expect(gateFor("").allow({ headers: {} } as never)).toBe(true);
  });

  it("密码对就过，错的 / 没带的 / 坏编码的 / 非 Basic 的一律不过", () => {
    const gate = gateFor("test-key");
    const req = (auth?: string) => ({ headers: auth === undefined ? {} : { authorization: auth } }) as never;
    expect(gate.allow(req(basic("test-key")))).toBe(true);
    expect(gate.allow(req(basic("wrong")))).toBe(false);
    expect(gate.allow(req())).toBe(false);
    expect(gate.allow(req("Bearer token"))).toBe(false);
    expect(gate.allow(req("Basic !!!not-base64!!!"))).toBe(false);
    expect(gate.allow(req("Basic " + Buffer.from("nocolon").toString("base64")))).toBe(false);
  });

  it("用户名随意，只有密码算数", () => {
    expect(gateFor("test-key").allow({ headers: { authorization: basic("test-key", "anyone") } } as never)).toBe(
      true,
    );
  });

  it("401 带上 WWW-Authenticate，浏览器才会弹框", () => {
    const gate = gateFor("test-key");
    const { res, headers } = stubRes();
    gate.challenge(res);
    expect(headers().status).toBe("401");
    expect(headers()["www-authenticate"]).toMatch(/^Basic realm=/);
  });

  it("Basic 通过后种会话 cookie，之后不带凭据也能过（WS 握手就靠这条）", () => {
    const gate = gateFor("test-key");
    const { res, headers } = stubRes();
    expect(gate.allow({ headers: { authorization: basic("test-key") } } as never, res)).toBe(true);
    const cookie = String(headers()["set-cookie"]);
    expect(cookie).toMatch(/^aivn_session=\S+; Path=\/; HttpOnly/);
    const token = cookie.split(";")[0]!.split("=")[1]!;
    // 没有 Authorization 头，只有 cookie
    expect(gate.allow({ headers: { cookie: `aivn_session=${token}` } } as never)).toBe(true);
    // 换个进程发的 token 不认
    expect(gate.allow({ headers: { cookie: "aivn_session=别人的" } } as never)).toBe(false);
  });

  it("过期会话不认", () => {
    const gate = gateFor("test-key");
    const { res, headers } = stubRes();
    gate.allow({ headers: { authorization: basic("test-key") } } as never, res);
    const token = String(headers()["set-cookie"]).split(";")[0]!.split("=")[1]!;
    const stale = gateFor("test-key");
    // 新 gate 的 token 表是空的（同进程重启 = 都要重输密码）
    expect(stale.allow({ headers: { cookie: `aivn_session=${token}` } } as never)).toBe(false);
  });
});

describe("同端口的前端产物", () => {
  it("命中文件回它，API 路径不碰，未知路径回 index.html", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stage-web-"));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "assets"), { recursive: true });
    await writeFile(join(dir, "index.html"), "<div id=root>");
    await writeFile(join(dir, "assets", "app.js"), "console.log(1)");

    const hit = async (path: string) => {
      const calls: string[] = [];
      const res = {
        writeHead: (status: number, headers: Record<string, string>) =>
          calls.push(`${status} ${headers["content-type"]}`),
        end: () => calls.push("end"),
        once: () => {},
        on: () => {},
        emit: () => {},
        write: () => true,
        removeListener: () => {},
        destroy: () => {},
      } as never;
      const served = await serveWebBundle({ method: "GET", url: path } as never, res, dir);
      return { served, calls };
    };

    expect((await hit("/assets/app.js")).calls[0]).toMatch(/200 text\/javascript/);
    expect((await hit("/")).calls[0]).toMatch(/200 text\/html/);
    // 单页应用按 hash 路由：任何未知路径都回首页
    expect((await hit("/play/demo/stage")).calls[0]).toMatch(/200 text\/html/);
    // 后端自己的路径不能被静态目录截胡
    expect((await hit("/api/plays")).served).toBe(false);
    expect((await hit("/plays/demo/assets/sprites/koharu/neutral.png")).served).toBe(false);
    expect((await hit("/library/backgrounds")).served).toBe(false);
    // 目录穿越在拼接时就掐掉，落回首页
    expect((await hit("/../../etc/passwd")).calls[0]).toMatch(/200 text\/html/);
  });
});

describe("闸门 + 静态 + API 同端口", () => {
  it("匿名先弹框，带对密码拿到页面并换到会话 cookie", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stage-web-"));
    await writeFile(join(dir, "index.html"), "<div id=root>");
    const gate = gateFor("test-key");
    const server: Server = createServer((req, res) => {
      if (!gate.allow(req, res)) {
        gate.challenge(res);
        return;
      }
      void (async () => {
        if (await serveWebBundle(req, res, dir)) return;
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
      })();
    });
    await new Promise<void>((done) => server.listen(0, done));
    const port = (server.address() as { port: number }).port;

    const anon = await fetch(`http://127.0.0.1:${port}/`);
    expect(anon.status).toBe(401);
    expect(anon.headers.get("www-authenticate")).toMatch(/^Basic/);

    const ok = await fetch(`http://127.0.0.1:${port}/`, { headers: { authorization: basic("test-key") } });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("<div id=root>");
    const session = ok.headers.get("set-cookie");
    expect(session).toMatch(/^aivn_session=/);

    const api = await fetch(`http://127.0.0.1:${port}/api/plays`, { headers: { authorization: basic("test-key") } });
    expect(await api.text()).toBe('{"ok":true}');

    await new Promise<void>((done) => server.close(() => done()));
  });

  // WS 握手走 index.ts 里的同一条判断，只是没有响应头可种 cookie，
  // 所以它只能认已有会话。101 那段握手是 node 的事，不在这里模拟。
  it("WS 握手：匿名不过，带会话 cookie 的过（浏览器不会在握手里重放 Basic 凭据）", () => {
    const gate = gateFor("test-key");
    const { res, headers } = stubRes();
    gate.allow({ headers: { authorization: basic("test-key") } } as never, res);
    const cookie = String(headers()["set-cookie"]).split(";")[0]!;
    expect(gate.allow({ headers: {} } as never)).toBe(false);
    expect(gate.allow({ headers: { cookie } } as never)).toBe(true);
  });
});
