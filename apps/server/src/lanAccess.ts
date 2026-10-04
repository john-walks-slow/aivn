/**
 * 局域网访问：监听地址怎么定，以及「一键放行 Windows 防火墙」那一件事。
 *
 * 防火墙规则按**程序**写而不是按端口：服务端口会漂（`listenWithFallback`），
 * 按端口写的规则换个端口就失效。
 */
import { spawn } from "node:child_process";
import { isPackaged } from "./paths.js";

/** 防火墙里的规则名：删除与新增用同一个，重复点不会堆出第二条。 */
export const FIREWALL_RULE_NAME = "AIVN 局域网访问";

/**
 * 监听地址三态：显式给了 `--host` / `STAGE_HOST` 就是它（dev 与脚本的老习惯不变），
 * 没给就看设置页的「允许局域网访问」——开着听所有网卡，关着只听本机。
 */
export function resolveHost(explicit: string | undefined, lanAccess: boolean): string {
  return explicit?.trim() || (lanAccess ? "0.0.0.0" : "127.0.0.1");
}

/**
 * 请求是不是从本机来的。
 *
 * 只有回环地址配触发提权：局域网上的任何人都不能远程把 UAC 弹窗糊到用户脸上。
 */
export function isLoopback(address: string | undefined): boolean {
  const addr = (address ?? "").replace(/^::ffff:/, "");
  return addr === "::1" || addr.startsWith("127.");
}

/**
 * 这条能力只在装好的 Windows 版里成立：命令要拿 `process.execPath` 写进规则，
 * 开发态的 node 进程没有那个 exe 路径可写，也没有 UAC 好弹。
 */
export function firewallAvailable(): boolean {
  return process.platform === "win32" && isPackaged();
}

/**
 * 提权写一条入站放行规则，返回一句人话给设置页显示。
 *
 * 先删同名再新增，所以重复点是同一条规则；用户在 UAC 上点「否」会走失败分支——
 * 那是一次失败的操作，要如实回报，别静默。
 */
export async function openFirewallRule(
  execPath = process.execPath,
): Promise<{ ok: boolean; message: string }> {
  const inner = [
    `netsh advfirewall firewall delete rule name="${FIREWALL_RULE_NAME}" | Out-Null`,
    `netsh advfirewall firewall add rule name="${FIREWALL_RULE_NAME}" dir=in action=allow program="${execPath}" enable=yes profile=any`,
    `exit $LASTEXITCODE`,
  ].join("\n");
  // 整段用 -EncodedCommand 递进去：规则名带中文、路径带空格，走命令行引号迟早出错
  const outer = [
    `$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encodeCommand(inner)}'`,
    `exit $p.ExitCode`,
  ].join("\n");
  const code = await runPowerShell(outer);
  return code === 0
    ? { ok: true, message: `已在 Windows 防火墙里放行（入站规则「${FIREWALL_RULE_NAME}」）` }
    : { ok: false, message: "没有放行成功：可能是在 UAC 提示上点了「否」，或者规则被系统拒绝" };
}

/** PowerShell 认的编码是 UTF-16LE 的 base64。 */
function encodeCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function runPowerShell(script: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodeCommand(script)],
      { windowsHide: true },
    );
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text !== "") console.warn(`[aivn] 防火墙规则: ${text}`);
    });
    child.on("error", (error) => {
      console.warn(`[aivn] 防火墙规则: 起不了 powershell（${error.message}）`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}
