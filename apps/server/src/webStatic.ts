import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * 把构建好的前端（`apps/web/dist`）挂在同一个端口上。
 *
 * 为什么要它：开发时前端是 vite dev server、后端是另一个端口，但公网部署只需要一个入口——
 * 隧道指向一个固定端口，浏览器要的 `/api`、`/ws`、`/plays` 与页面本身必须同源，
 * 否则 Cookie/WS 握手和相对路径全要另开豁免。`pnpm -r build` 之后 dist 存在就自动挂上。
 */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/** 前缀属于后端，不进静态目录：API、剧目素材、素材库。 */
const API_PREFIXES = ["api", "plays", "library"];

function mimeOf(file: string): string {
  const dot = file.lastIndexOf(".");
  return MIME[file.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

/**
 * 命中并写完返回 true；不是前端资源（API 路径 / 非 GET）返回 false，交给上层路由。
 *
 * 单页应用按 hash 路由（`#/play/demo/stage`），所以除了真实文件，其余路径一律回
 * `index.html`——按 pathname 做的多页路由才需要更细的回退规则，这里不需要。
 */
export async function serveWebBundle(
  req: IncomingMessage,
  res: ServerResponse,
  distDir: string,
): Promise<boolean> {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return false;

  const url = new URL(req.url ?? "/", "http://localhost");
  const head = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (API_PREFIXES.includes(head)) return false;
  if (!existsSync(join(distDir, "index.html"))) return false;

  const asked = decodeURIComponent(url.pathname);
  const target = safeJoin(distDir, asked);
  const file = target && existsSync(target) && statSync(target).isFile() ? target : join(distDir, "index.html");

  res.writeHead(200, {
    "content-type": mimeOf(file),
    // index.html 不能缓存（它带着上一版的资源文件名）；构建产物带 hash 的可以长期缓存。
    "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
  });
  if (method === "HEAD") {
    res.end();
    return true;
  }
  await new Promise<void>((done, fail) => {
    createReadStream(file)
      .on("error", fail)
      .on("end", done)
      .pipe(res);
  });
  return true;
}

/** 把 URL 路径拼到目录里，且必须留在目录内（`/../../etc/passwd` 这类要在这里就掐掉）。 */
function safeJoin(dir: string, pathname: string): string | null {
  // pathname 是绝对路径（`/assets/app.js`），直接 resolve 会以它为准、把 dir 顶掉，
  // 所以先去掉开头的斜杠再拼。
  const relative = normalize(pathname).replace(/^[/\\]+/, "");
  const joined = resolve(dir, relative);
  const root = resolve(dir);
  return joined.startsWith(`${root}/`) ? joined : null;
}