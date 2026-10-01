import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * 公网入口的密码闸门（HTTP Basic + 会话 cookie）。
 *
 * 为什么是 Basic 而不是登录页：stage-ai 没有用户体系，多剧目共用一台服务器，
 * 公开隧道前面唯一要挡的是「陌生人打开首页」。Basic 由浏览器自己弹框、凭据随请求走，
 * 不需要用户表和登出状态。
 *
 * **但 Basic 单独用是不通的**：浏览器只在同源 HTTP 请求上重放已缓存的凭据，
 * WebSocket 握手不走那条路（2026-10-01 实测：页面卡在「正在连接舞台…」，
 * 手工 `new WebSocket` 直接超时，curl 带凭据握手却是 101）。所以 Basic 通过之后
 * 发一枚会话 cookie，WS 与后续请求都改由 cookie 过闸——cookie 是同源请求一定会带的东西。
 *
 * token 存在进程内存里：单进程单用户的部署形态，重启即失效（重新输一次密码），
 * 换不来的是「磁盘上留一份谁都能抄的会话表」。
 */

/** 会话 cookie 名。带 HttpOnly：JS 读不到，XSS 也偷不走。 */
const COOKIE = "stage_session";
/** 会话有效期 7 天。过期或进程重启后要重新输密码——本地个人部署不需要更长。 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 定长比较：长度不同直接 false，等长的走 timingSafeEqual（不等长直接比会泄漏长度）。 */
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookiesOf(req: IncomingMessage): string {
  return req.headers.cookie ?? "";
}

export class WebGate {
  private readonly tokens = new Map<string, number>();

  constructor(private readonly password: string) {}

  /** 没配密码 = 不设防（本地直连的开发场景）。 */
  get open(): boolean {
    return this.password === "";
  }

  /** cookie 里的会话还有效吗。过期顺手清掉，免得 Map 无限长。 */
  private sessionOk(req: IncomingMessage): boolean {
    const token = cookiesOf(req)
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    if (!token) return false;
    const expires = this.tokens.get(token);
    if (expires === undefined) return false;
    if (expires < Date.now()) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  /**
   * 请求过没过闸。过 HTTP 时若凭的是 Basic，就顺手种一枚会话 cookie；
   * WS 握手没有响应体可写头，靠 Basic 那一路走不通，所以它只能靠已有 cookie（或浏览器自动补 Basic）。
   */
  allow(req: IncomingMessage, res?: ServerResponse): boolean {
    if (this.open) return true;
    if (this.sessionOk(req)) return true;
    if (!this.hasBasic(req)) return false;
    if (res && !res.headersSent) {
      const token = randomBytes(32).toString("base64url");
      this.tokens.set(token, Date.now() + TTL_MS);
      const secure = (req.socket as { encrypted?: boolean } | undefined)?.encrypted ? "; Secure" : "";
      res.setHeader("set-cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Max-Age=${TTL_MS / 1000}${secure}`);
    }
    return true;
  }

  /** 未授权时回 401 + `WWW-Authenticate`——没有这行浏览器不弹框，直接给空白页。 */
  challenge(res: ServerResponse): void {
    res.writeHead(401, {
      "www-authenticate": 'Basic realm="stage-ai", charset="UTF-8"',
      "content-type": "text/plain; charset=utf-8",
    });
    res.end("需要密码");
  }

  private hasBasic(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Basic ")) return false;
    let decoded: string;
    try {
      decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    } catch {
      return false;
    }
    const colon = decoded.indexOf(":");
    return colon !== -1 && sameSecret(decoded.slice(colon + 1), this.password);
  }
}