import { afterEach, describe, expect, it } from "vitest";
import { MAX_WEB_IMAGE_BYTES, readCapped, WebImageFetcherImpl, webImageBase } from "../src/webImage.js";

/**
 * 网络图下载的出网边界。
 *
 * `view_image` 的地址是模型给的：页面正文里写一句「参考 http://内网地址/x.png」，
 * agent 就可能真的去取。所以私网、回环、链路本地与非 http 协议必须在下载前就拒掉，
 * 而且每跳重定向都重判——只查首跳是最常见的绕过。
 */

const fetcher = new WebImageFetcherImpl();

async function rejects(url: string): Promise<string> {
  return fetcher.fetchImage(url).then(
    () => expect.fail(`不该下载成功：${url}`),
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

describe("webImage：出网边界", () => {
  it("回环与私有网段一律拒（含云元数据与运营商 NAT）", async () => {
    for (const url of [
      "http://127.0.0.1:8787/api/config",
      "http://127.1/x.png",
      "http://10.1.2.3/x.png",
      "http://172.16.0.1/x.png",
      "http://192.168.1.1/x.png",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/x.png",
      "http://0.0.0.0/x.png",
      "http://[::1]/x.png",
      "http://[fd00::1]/x.png",
      "http://[fe80::1]/x.png",
      // v4 映射的 v6 是同一条路，也要挡住（点分与十六进制两种写法，URL 规范化后给后者）
      "http://[::ffff:127.0.0.1]/x.png",
      "http://[::ffff:7f00:1]/x.png",
      // v4 兼容写法 ::/96：已废弃但网络栈照样认，只挡 ::ffff: 前缀会漏
      "http://[::127.0.0.1]/x.png",
      "http://[::7f00:1]/x.png",
      "http://[::a00:1]/x.png",
    ]) {
      expect(await rejects(url)).toContain("不下载内网地址");
    }
  });

  it("localhost 名字在解析之前就拒（不依赖 DNS 说它解析到哪）", async () => {
    expect(await rejects("http://localhost:8787/api/config")).toContain("不下载内网地址");
    expect(await rejects("http://box.local/x.png")).toContain("不下载内网地址");
  });

  it("非 http(s) 协议拒掉：file: 与 data: 各是一条读本机的路", async () => {
    expect(await rejects("file:///etc/passwd")).toContain("只支持 http/https");
    expect(await rejects("data:image/png;base64,iVBOR")).toContain("只支持 http/https");
    expect(await rejects("gopher://127.0.0.1:11211/_stats")).toContain("只支持 http/https");
  });

  it("不是网址的字符串直接报错，不去猜", async () => {
    expect(await rejects("assets/sprites/mio/neutral.png")).toContain("不是合法的网址");
  });

  it("DNS 解析失败照实说，不吞成「下不了」", async () => {
    const message = await rejects("http://this-host-does-not-exist.invalid/x.png");
    expect(message).toContain("解析不了");
  });

  it("缓存名按 URL 摘要，同一个网址永远落同一个文件", () => {
    expect(webImageBase("https://example.com/a.jpg")).toBe(webImageBase("https://example.com/a.jpg"));
    expect(webImageBase("https://example.com/a.jpg")).not.toBe(webImageBase("https://example.com/b.jpg"));
    expect(webImageBase("https://example.com/a.jpg")).toMatch(/^[0-9a-f]{32}$/);
  });
});

/**
 * 大小上限必须在**收的过程中**判。
 *
 * `content-length` 只是一条声明，chunked 响应根本没有这个头：先 arrayBuffer 收全再判大小，
 * 一个几百 MB 的响应就能把服务打死。这里用一条人造的无限流证明「读到上限就停手」。
 */
describe("webImage：收流时截断", () => {
  it("超过上限就抛错，不会把整条流收完", async () => {
    let pulled = 0;
    const counting = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    await expect(readCapped(counting, new URL("https://example.com/a.png"))).rejects.toThrow("超过 20MB 上限");
    // 收到上限就断：拉取次数应当贴近上限，而不是跟着对方流的长度走
    expect(pulled).toBeLessThanOrEqual(Math.ceil(MAX_WEB_IMAGE_BYTES / 1048576) + 2);
  });

  it("上限内的流照常读完，字节逐个不差", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5]));
        controller.close();
      },
    });
    const data = await readCapped(body, new URL("https://example.com/a.png"));
    expect([...data]).toEqual([1, 2, 3, 4, 5]);
  });

  it("没有响应体照实报错", async () => {
    await expect(readCapped(null, new URL("https://example.com/a.png"))).rejects.toThrow("没有响应体");
  });

  it("读超上限后连接真的断掉了（对端流收到 cancel，不再往下发）", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readCapped(stream, new URL("https://example.com/a.png"))).rejects.toThrow("超过 20MB 上限");
    expect(cancelled).toBe(true);
  });
});
/**
 * 出口代理读标准环境变量，不另开配置项。
 *
 * 这是「设一次就有」的那条保证：装服务的那台机器上 `HTTPS_PROXY` 设了，图就能下；
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
      expect((new WebImageFetcherImpl() as unknown as { dispatcher: unknown }).dispatcher).toBeDefined();
    }
  });

  it("一个都没设就不建代理，直连", () => {
    for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) {
      delete process.env[key];
    }
    expect((new WebImageFetcherImpl() as unknown as { dispatcher: unknown }).dispatcher).toBeUndefined();
    // 空串也是「没配」，不是「代理地址是空」
    process.env.HTTPS_PROXY = "  ";
    expect((new WebImageFetcherImpl() as unknown as { dispatcher: unknown }).dispatcher).toBeUndefined();
  });
});
