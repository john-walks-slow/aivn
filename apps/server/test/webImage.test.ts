import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { envFetch, proxyFromEnv } from "../src/webImage.js";

/**
 * 这一份只剩服务端的**出网接线**：出口代理读标准环境变量，不另开配置项。
 *
 * 下载逻辑与内网判据（含大小写不敏感的代理都认、空值等于直连这些语义）在 `@aivn/agent`
 * 的包单测里。这是「设一次就有」的那条保证：装服务的那台机器上 `HTTPS_PROXY` 设了，图就能下；
 * 一个专门的 `STAGE_*_PROXY` 还得用户记得去设置面板里填。
 */
describe("webImage：出口代理走环境变量", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("HTTPS_PROXY / HTTP_PROXY 都被认，大小写都认，空值等于直连", () => {
    for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) {
      process.env.HTTPS_PROXY = "";
      process.env.https_proxy = "";
      process.env.HTTP_PROXY = "";
      process.env.http_proxy = "";
      process.env[key] = "http://127.0.0.1:7890";
      expect(proxyFromEnv(), key).toBeDefined();
    }
  });

  it("一个都没设就不建代理，直连", () => {
    for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) {
      delete process.env[key];
    }
    expect(proxyFromEnv()).toBeUndefined();
    // 空串也是「没配」，不是「代理地址是空」
    process.env.HTTPS_PROXY = "  ";
    expect(proxyFromEnv()).toBeUndefined();
  });

  it("envFetch：即使没配 NO_PROXY，127.0.0.1 / localhost 也自动绕过代理直连", async () => {
    const srv = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("loopback-direct");
    });
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
    const port = (srv.address() as { port: number }).port;

    try {
      // 指向一个不通的端口：如果回环地址被送进代理就会连接失败
      process.env.HTTP_PROXY = "http://127.0.0.1:1";
      process.env.HTTPS_PROXY = "http://127.0.0.1:1";
      delete process.env.NO_PROXY;
      delete process.env.no_proxy;

      const res = await envFetch(`http://127.0.0.1:${port}/ping`, { method: "GET" });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("loopback-direct");
    } finally {
      srv.close();
    }
  });
});
