import { describe, expect, it } from "vitest";
import { firewallRuleScript, isLoopback } from "../src/lanAccess.js";

describe("放行防火墙要跑的那段脚本", () => {
  /**
   * 用户在弹窗上点「取消」之后，Windows 会自己写一条按程序命名的**阻止**规则，
   * 而显式阻止的优先级高于放行：脚本里漏掉这一步，按钮会回报「已放行」而局域网
   * 依旧连不上（2026-10-04 在真机上撞到过，当时那条 Allow 已经在册且启用）。
   */
  it("先清掉自动生成的阻止规则，再写放行", () => {
    const script = firewallRuleScript("C:\\Users\\x\\aivn-server.exe");
    expect(script).toContain("-Direction Inbound -Action Block");
    expect(script).toContain("Remove-NetFirewallRule");
    expect(script).toContain("$exe = 'C:\\Users\\x\\aivn-server.exe'");
    expect(script.indexOf("Remove-NetFirewallRule")).toBeLessThan(script.indexOf("firewall add rule"));
  });

  it("路径里的单引号不拆掉脚本", () => {
    expect(firewallRuleScript("C:\\it's\\aivn.exe")).toContain("$exe = 'C:\\it''s\\aivn.exe'");
  });
});

describe("请求是不是从本机来的", () => {
  it("回环的几种写法都算本机", () => {
    for (const address of ["127.0.0.1", "127.5.5.5", "::1", "::ffff:127.0.0.1"]) {
      expect(isLoopback(address)).toBe(true);
    }
  });

  it("局域网地址、没有地址都不算", () => {
    for (const address of ["192.0.2.10", "::ffff:192.0.2.10", "10.0.0.2", undefined, ""]) {
      expect(isLoopback(address)).toBe(false);
    }
  });
});
