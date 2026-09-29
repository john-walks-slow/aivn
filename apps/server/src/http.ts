import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PlayLibrary } from "./store.js";
import type { PlayHouse } from "./playhouse.js";
import type { SettingsFile } from "./configApi.js";
import type { VoiceCatalogService } from "./voiceCatalog.js";
import { parsePlayConfig } from "@stage-ai/core";

const BODY_LIMIT = 64 * 1024 * 1024;

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  json: "application/json",
  zip: "application/zip",
};

const ASSET_KINDS = new Set(["sprites", "backgrounds", "cg", "sfx", "bgm"]);

function json(res: ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(data);
}

function fail(res: ServerResponse, code: number, message: string): void {
  json(res, code, { error: message });
}

function safeSeg(seg: string): boolean {
  return /^[\w][\w.-]*$/.test(seg) && !seg.includes("..");
}

/** 素材目录段校验（上传 kind 参数）：sprites/<charId> 或单段 kind。 */
function safeAssetKind(segments: string[]): string | null {
  if (segments.length === 0 || segments.length > 2) return null;
  const kind = segments[0] ?? "";
  if (!ASSET_KINDS.has(kind)) return null;
  if (segments.length !== (kind === "sprites" ? 2 : 1)) return null;
  return segments.every(safeSeg) ? segments.join("/") : null;
}

/** 素材完整路径校验（静态服务）：kind 段 + 文件名。 */
function safeAssetPath(segments: string[]): string | null {
  const file = segments[segments.length - 1] ?? "";
  const kind = safeAssetKind(segments.slice(0, -1));
  return kind && safeSeg(file) ? `${kind}/${file}` : null;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT) throw new Error("请求体过大（上限 64MB）");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx + 1).toLowerCase();
}

/**
 * REST API + 素材静态服务（P2）。
 * 剧目库 / 就绪门 / 素材上传管理 / 剧目包导入导出 / play.json 编辑 / 剧目删除。
 */
export async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  library: PlayLibrary,
  playhouse: PlayHouse,
  settings: SettingsFile | undefined,
  voices: VoiceCatalogService,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method ?? "GET";

  try {
    // —— TTS 音频静态服务：/plays/:id/media/tts/<hash>.mp3（语音管线预取缓存） ——
    if (parts[0] === "plays" && parts[1] && parts[2] === "media" && parts[3] === "tts" && method === "GET") {
      const [, playId, , , file] = parts;
      if (!/^[\w-]+$/.test(playId) || !/^[\w-]+\.mp3$/.test(file ?? "")) return fail(res, 404, "未找到");
      const path = library.store(playId).mediaPath(file!);
      if (!existsSync(path)) return fail(res, 404, "未找到");
      res.writeHead(200, { "content-type": "audio/mpeg", "cache-control": "public, max-age=86400" });
      res.end(await readFile(path));
      return;
    }

    // —— 生图产物静态服务：/plays/:id/media/img/<hash>.jpg（D6 预发射缓存） ——
    if (parts[0] === "plays" && parts[1] && parts[2] === "media" && parts[3] === "img" && method === "GET") {
      const [, playId, , , file] = parts;
      if (!/^[\w-]+$/.test(playId) || !/^[\w]+\.jpg$/.test(file ?? "")) return fail(res, 404, "未找到");
      const path = library.store(playId).imagePath(file!);
      if (!existsSync(path)) return fail(res, 404, "未找到");
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" });
      res.end(await readFile(path));
      return;
    }

    // —— 素材静态服务：/plays/:id/assets/<kind>/<...> ——
    if (parts[0] === "plays" && parts[1] && parts[2] === "assets" && method === "GET") {
      const [, playId, , ...segments] = parts;
      if (!/^[\w-]+$/.test(playId)) return fail(res, 404, "未找到");
      const kindPath = safeAssetPath(segments);
      if (!kindPath) return fail(res, 404, "未找到");
      const file = library.store(playId).assetPath(kindPath);
      const mime = MIME[extOf(file)];
      if (!mime || !existsSync(file)) return fail(res, 404, "未找到");
      res.writeHead(200, { "content-type": mime, "cache-control": "no-cache" });
      res.end(await readFile(file));
      return;
    }

    // —— 健康与资源指标（P6）：给过夜 soak 采样服务端真实 RSS，而不是客户端自己 ——
    if (parts[0] === "api" && parts[1] === "health" && parts.length === 2) {
      const mem = process.memoryUsage();
      return json(res, 200, {
        ok: true,
        uptimeSec: Math.round(process.uptime()),
        rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
        externalMb: Math.round((mem.external / 1024 / 1024) * 10) / 10,
        plays: playhouse.livePlayCount,
      });
    }

    // —— Fish 音色库：目录 + 单条解析（角色卡音色选择面板的数据源） ——
    if (parts[0] === "api" && parts[1] === "voices" && method === "GET") {
      if (parts.length === 2) {
        return json(res, 200, await voices.get(url.searchParams.get("refresh") === "1"));
      }
      if (parts.length === 3) {
        const id = parts[2]!;
        if (!/^[0-9a-f]{32}$/.test(id)) return fail(res, 400, "音色 id 非法");
        return json(res, 200, await voices.resolve(id));
      }
    }

    // —— 设置面板（P6）：.env 与 TTS keys 全部 GUI 可改，不要求用户碰配置文件 ——
    if (parts[0] === "api" && parts[1] === "config" && parts.length === 2) {
      if (!settings) return fail(res, 404, "设置面板未启用");
      if (method === "GET") return json(res, 200, settings.read());
      if (method === "PUT") {
        const patch = JSON.parse((await readBody(req)).toString("utf8"));
        return json(res, 200, { changed: settings.write(patch) });
      }
      return fail(res, 405, "不支持的方法");
    }
    if (parts[0] === "api" && parts[1] === "config" && parts[2] === "tts-keys" && parts.length === 3) {
      if (!settings) return fail(res, 404, "设置面板未启用");
      if (method === "GET") {
        const keys = settings.readTtsKeys();
        return json(res, 200, { count: keys.length, keys: keys.map((k) => `${k.slice(0, 6)}••••`) });
      }
      if (method === "PUT") {
        const body = JSON.parse((await readBody(req)).toString("utf8")) as { keys?: unknown };
        if (!Array.isArray(body.keys) || body.keys.some((k) => typeof k !== "string" || !k.trim())) {
          return fail(res, 400, "TTS keys 必须是字符串数组");
        }
        settings.writeTtsKeys(body.keys as string[]);
        return json(res, 200, { count: (body.keys as string[]).length });
      }
      return fail(res, 405, "不支持的方法");
    }

    // —— REST API ——
    if (parts[0] !== "api" || parts[1] !== "plays") return fail(res, 404, "未找到");

    if (parts.length === 2) {
      if (method === "GET") return json(res, 200, await library.list());
      return fail(res, 405, "不支持的方法");
    }
    if (parts[2] === "import" && parts.length === 3) {
      if (method !== "POST") return fail(res, 405, "不支持的方法");
      const id = await library.importZip(await readBody(req));
      return json(res, 200, { id });
    }
    if (parts[2] === "create" && parts.length === 3) {
      if (method !== "POST") return fail(res, 405, "不支持的方法");
      const body = JSON.parse((await readBody(req)).toString("utf8")) as { id: string; title?: string };
      if (!/^[\w-]+$/.test(body.id ?? "")) return fail(res, 400, "剧目 id 仅允许字母数字与 _-");
      await library.createEmpty(body.id, body.title ?? body.id);
      return json(res, 200, { id: body.id });
    }

    const playId = parts[2] ?? "";
    if (!/^[\w-]+$/.test(playId)) return fail(res, 400, "非法剧目 id");
    const store = library.store(playId);
    const sub = parts[3];

    if (!sub) {
      if (method === "GET") {
        const play = await store.loadPlay();
        return json(res, 200, { play, readiness: await store.readiness() });
      }
      if (method === "DELETE") {
        await playhouse.deletePlay(playId);
        return json(res, 200, { ok: true });
      }
      return fail(res, 405, "不支持的方法");
    }
    if (sub === "lineage" && parts.length === 4) {
      // 路线树（P6）：全量节点（含废弃分支）+ 书签；打开视图/操作后/手动刷新时取
      if (method !== "GET") return fail(res, 405, "不支持的方法");
      const runtime = await playhouse.get(playId);
      return json(res, 200, runtime.orchestrator.lineageView());
    }

    if (sub === "play" && parts.length === 4) {
      if (method !== "PUT") return fail(res, 405, "不支持的方法");
      const play = parsePlayConfig(JSON.parse((await readBody(req)).toString("utf8")));
      await store.savePlay(play);
      await playhouse.reload(playId); // 保存即生效：音色/主角卡/语音语言/素材清单重建
      return json(res, 200, { ok: true });
    }
    if (sub === "readiness" && parts.length === 4) {
      if (method === "GET") return json(res, 200, await store.readiness());
      return fail(res, 405, "不支持的方法");
    }
    // —— 剧目主题层：<link> 直挂，文件不存在就 404（浏览器静默忽略，走默认主题）——
    if (sub === "theme.css" && method === "GET") {
      const path = join(store.dir, "theme.css");
      if (!existsSync(path)) return fail(res, 404, "未找到");
      res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-cache" });
      res.end(await readFile(path));
      return;
    }
    // —— 工坊文件浏览/编辑（D9）：白名单在 PlayFiles，越界路径直接 400 ——
    if (sub === "files" && parts.length === 4) {
      const runtime = await playhouse.get(playId);
      if (method === "GET") {
        const path = url.searchParams.get("path");
        if (!path) return json(res, 200, await runtime.workshop.files.list());
        return json(res, 200, { path, content: await runtime.workshop.files.read(path) });
      }
      if (method === "PUT") {
        const body = JSON.parse((await readBody(req)).toString("utf8")) as { path?: string; content?: string };
        if (!body.path) return fail(res, 400, "缺少 path");
        await runtime.workshop.writeFile(body.path, body.content ?? "");
        return json(res, 200, { ok: true });
      }
      if (method === "DELETE") {
        const path = url.searchParams.get("path") ?? "";
        await runtime.workshop.removeFile(path);
        return json(res, 200, { ok: true });
      }
      return fail(res, 405, "不支持的方法");
    }
    if (sub === "assets" && parts.length === 4) {
      if (method === "GET") return json(res, 200, await store.listAssets());
      if (method === "POST") {
        const kindPath = safeAssetKind((url.searchParams.get("kind") ?? "").split("/").filter(Boolean));
        const name = url.searchParams.get("name") ?? "";
        if (!kindPath || !safeSeg(name) || !MIME[extOf(name)])
          return fail(res, 400, "非法素材路径或格式");
        await store.writeAsset(kindPath, name, await readBody(req));
        await playhouse.reload(playId); // 素材清单即时生效
        return json(res, 200, { ok: true });
      }
      if (method === "DELETE") {
        const kindPath = safeAssetKind((url.searchParams.get("kind") ?? "").split("/").filter(Boolean));
        const name = url.searchParams.get("name") ?? "";
        if (!kindPath || !safeSeg(name)) return fail(res, 400, "非法素材路径");
        await store.deleteAsset(kindPath, name);
        await playhouse.reload(playId); // 素材清单即时生效
        return json(res, 200, { ok: true });
      }
      return fail(res, 405, "不支持的方法");
    }
    if (sub === "tts-preview" && parts.length === 4) {
      if (method !== "POST") return fail(res, 405, "不支持的方法");
      const body = JSON.parse((await readBody(req)).toString("utf8")) as { voiceId?: string };
      if (!body.voiceId) return fail(res, 400, "缺少 voiceId");
      return json(res, 200, { url: await playhouse.ttsPreview(playId, body.voiceId) });
    }
    if (sub === "polish" && parts.length === 4) {
      if (method !== "POST") return fail(res, 405, "不支持的方法");
      const body = JSON.parse((await readBody(req)).toString("utf8")) as { text?: string };
      const text = body.text?.trim();
      if (!text) return fail(res, 400, "缺少待润色文本");
      if (text.length > 2000) return fail(res, 400, "文本过长（上限 2000 字）");
      return json(res, 200, { text: await playhouse.polish(playId, text) });
    }
    if (sub === "export" && parts.length === 4) {
      if (method !== "GET") return fail(res, 405, "不支持的方法");
      const zip = await library.exportZip(playId);
      res.writeHead(200, {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${playId}.zip"`,
      });
      res.end(Buffer.from(zip));
      return;
    }
    return fail(res, 404, "未找到");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(res, 400, message);
  }
}
