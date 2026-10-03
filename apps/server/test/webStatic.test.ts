import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveWebBundle, safeJoin } from "../src/webStatic.js";

/**
 * 这一组守的是 `safeJoin` 的越界判断。
 *
 * 2026-10-04：它的包含关系是拿 `${root}/` 去 `startsWith` 判的，而 Windows 的 `resolve`
 * 产出的是 `\`——于是 `apps/web/dist/assets/*.js` 被判成越界，全部回退到 index.html，
 * 打包出来的桌面版一片白屏（Linux 上分隔符正好是 `/`，所以开发和 CI 都没露头）。
 * 用例本身不分平台，但在 Windows 上跑才会真正咬住这个回归。
 */
describe("safeJoin", () => {
  const root = join(tmpdir(), "aivn-webstatic");

  it("认得目录里的嵌套文件", () => {
    expect(safeJoin(root, "/assets/index-abc.js")).toBe(join(root, "assets", "index-abc.js"));
  });

  it("目录本身不算命中（要回退到 index.html）", () => {
    expect(safeJoin(root, "/")).toBeNull();
    expect(safeJoin(root, "")).toBeNull();
  });

  it("越界的一律不给路径", () => {
    for (const attempt of ["/../secret", "/assets/../../secret", "/..%2Fsecret", "/a/../../b"]) {
      const joined = safeJoin(root, attempt);
      expect(joined === null || joined.startsWith(root)).toBe(true);
    }
  });
});

describe("serveWebBundle", () => {
  let server: Server;
  let base: string;
  let dist: string;

  beforeAll(async () => {
    dist = await mkdtemp(join(tmpdir(), "aivn-dist-"));
    await mkdir(join(dist, "assets"), { recursive: true });
    await writeFile(join(dist, "index.html"), "<!doctype html><div id=root></div>");
    await writeFile(join(dist, "assets", "index-abc.js"), "export const a = 1;");
    await writeFile(join(dist, "assets", "index-abc.css"), ".a{color:red}");

    server = createServer((req, res) => {
      void serveWebBundle(req, res, dist).then((handled) => {
        if (!handled) {
          res.writeHead(404).end("not handled");
        }
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(dist, { recursive: true, force: true });
  });

  const get = (path: string) =>
    new Promise<{ status: number; type: string | undefined; body: string }>((done, fail) => {
      httpRequest(`${base}${path}`, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => done({ status: res.statusCode ?? 0, type: res.headers["content-type"], body }));
      })
        .on("error", fail)
        .end();
    });

  it("构建产物按自己的 MIME 送出去，而不是被 index.html 顶掉", async () => {
    const js = await get("/assets/index-abc.js");
    expect(js.status).toBe(200);
    expect(js.type).toBe("text/javascript; charset=utf-8");
    expect(js.body).toContain("export const a = 1;");

    const css = await get("/assets/index-abc.css");
    expect(css.type).toBe("text/css; charset=utf-8");
    expect(css.body).toContain(".a{color:red}");
  });

  it("hash 路由的路径回 index.html，且不许缓存", async () => {
    const page = await get("/play/demo/stage");
    expect(page.type).toBe("text/html; charset=utf-8");
    expect(page.body).toContain("<div id=root></div>");
  });

  it("API 路径不归静态层管", async () => {
    const api = await get("/api/plays");
    expect(api.status).toBe(404);
    expect(api.body).toBe("not handled");
  });
});
