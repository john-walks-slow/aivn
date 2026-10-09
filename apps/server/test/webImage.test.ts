import { afterEach, describe, expect, it } from "vitest";
import { proxyFromEnv } from "../src/webImage.js";

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
});
