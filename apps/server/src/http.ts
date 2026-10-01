import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { withPlayConfigLock, type PlayLibrary } from "./store.js";
import type { AssetLibrary } from "./library.js";
import { importFromLibrary } from "./assetImport.js";
import { readGeneratedEntries, readPlayLedgerEntries } from "./imageAssets.js";
import type { PlayHouse } from "./playhouse.js";
import type { SettingsFile } from "./configApi.js";
import {
  parsePlayConfig,
  libraryEntryMatches,
  ASSET_KINDS as ASSET_KINDS_LIST,
  type AssetKind,
  type AssetMeta,
  type CgEntry,
  type GeneratedImageEntry,
} from "@stage-ai/core";
import type { VoiceCatalogService } from "./voiceCatalog.js";

const BODY_LIMIT = 64 * 1024 * 1024;

/** 创作口径落盘路径（工坊 agent 与设置页改的是同一份）。 */
const CRAFT_PATH = "memory/always/craft.md";
/** 世界观前提落盘路径（A 区注入 + 就绪门 + 剧目卡简介的唯一来源）。 */
const PREMISE_PATH = "memory/always/premise.md";

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
 * CG 页的台账：静态素材与站内生成的图合成一张清单。
 *
 * 同一 id 只留一条，静态优先——与 `stage/assets.ts` 的解析口径一致（用户导入的是最终资产，
 * 同名生成图只是还没被静态素材顶掉的那一份）。两类各自缺的东西在同一条里补齐：
 * 静态素材没有生图 prompt 但有素材表描述，生成的图反过来。
 */
function cgCatalog(
  playId: string,
  staticFiles: readonly string[],
  meta: Record<string, AssetMeta>,
  generated: readonly GeneratedImageEntry[],
): CgEntry[] {
  const out: CgEntry[] = [];
  const taken = new Set<string>();
  for (const file of staticFiles) {
    const id = file.slice(0, file.length - extOf(file).length - 1);
    if (!id || taken.has(id)) continue;
    taken.add(id);
    const generated_ = generated.find((g) => g.id === id);
    out.push({
      id,
      url: `/plays/${playId}/assets/cg/${file}`,
      origin: "asset",
      // 同名生成图也认：那条记录里带着这张 id 当初的出图描述（PlayAssets 记进 assets/generated.json 的
      // 与 media-cache 那份都在 generated 里），静态素材把它覆盖了但描述还在
      ...(generated_?.prompt ? { prompt: generated_.prompt } : {}),
      ...(meta[id]?.description ? { description: meta[id]!.description } : {}),
    });
  }
  for (const asset of generated) {
    if (asset.type !== "cg" || taken.has(asset.id)) continue;
    taken.add(asset.id);
    out.push({ id: asset.id, url: asset.url, origin: "generated", ...(asset.prompt ? { prompt: asset.prompt } : {}) });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * REST API + 素材静态服务（P2）。
 * 剧目库 / 就绪门 / 素材上传管理 / 剧目包导入导出 / play.json 编辑 / 剧目删除 / 资源库浏览与导入。
 */
export async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  library: PlayLibrary,
  playhouse: PlayHouse,
  settings?: SettingsFile,
  assets?: AssetLibrary,
  voices?: VoiceCatalogService,
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

    // —— 资源库素材静态服务：/library/<kind>/<id>/<file>（只读，用户目录里的原始文件） ——
    if (parts[0] === "library" && method === "GET") {
      if (parts.length !== 4) return fail(res, 404, "未找到");
      const [, kind, id, file] = parts;
      if (!assets || !kind || !id || !file || !safeSeg(file)) return fail(res, 404, "未找到");
      const mime = MIME[extOf(file)];
      if (!mime) return fail(res, 404, "未找到");
      let path: string;
      try {
        path = await assets.filePath(kind, id, file);
      } catch {
        return fail(res, 404, "未找到");
      }
      res.writeHead(200, { "content-type": mime, "cache-control": "public, max-age=600" });
      res.end(await readFile(path));
      return;
    }

    // —— 资源库清单（素材页「从资源库导入」与工坊浏览都走它）：kind 过滤 + 关键词搜索 ——
    if (parts[0] === "api" && parts[1] === "library" && parts.length === 2) {
      if (method !== "GET") return fail(res, 405, "不支持的方法");
      if (!assets) return json(res, 200, { entries: [], total: 0, counts: {} });
      const kind = url.searchParams.get("kind") ?? "";
      const q = url.searchParams.get("q") ?? "";
      const all = await assets.list();
      // 分类计数走全量：前端切了类别或搜了词之后，别的 tab 还得显示自己有多少条
      const counts: Record<string, number> = {};
      for (const e of all) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
      const entries = all.filter(
        (e) => (kind === "" || e.kind === kind) && libraryEntryMatches(e, q),
      );
      return json(res, 200, { entries, total: all.length, counts });
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
      if (!voices) return fail(res, 404, "音色库未启用");
      if (parts.length === 2) {
        return json(res, 200, await voices.get(url.searchParams.get("refresh") === "1"));
      }
      if (parts.length === 3) {
        const id = parts[2]!;
        if (!/^[0-9a-f]{32}$/.test(id)) return fail(res, 400, "音色 id 非法");
        return json(res, 200, await voices.resolve(id));
      }
    }

    // —— Agent 设置页的两个目录：网关模型清单 + 工具目录 ——
    if (parts[0] === "api" && parts[1] === "agents" && parts.length === 3 && method === "GET") {
      if (parts[2] === "models") {
        // 读不到网关就报错：模型下拉是「这个 agent 到底在用什么模型」的唯一真相，
        // 静默退化成默认模型的话，用户看到的和实际计费的对不上。
        const { models, defaultModel } = await playhouse.gatewayModels(url.searchParams.get("refresh") === "1");
        return json(res, 200, { models, defaultModel });
      }
      if (parts[2] === "tools") return json(res, 200, { tools: playhouse.tools() });
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
        // premise 不在 play.json 里（A 区注入用的那份），详情页要显示就现取
        return json(res, 200, { play, premise: await store.premise(), readiness: await store.readiness() });
      }
      if (method === "DELETE") {
        await playhouse.deletePlay(playId);
        return json(res, 200, { ok: true });
      }
      return fail(res, 405, "不支持的方法");
    }
    // —— 剧作家 session 历史（只读快照）：读活动档落盘的 session.json，不建 runtime、不改任何状态 ——
    if (sub === "history" && parts.length === 4) {
      if (method !== "GET") return fail(res, 405, "不支持的方法");
      // 走 active.json 指针那棵树：历史随周目隔离，跟同源的 lineage 一个道理
      const activeId = await library.saves(playId).readActive();
      const beats = activeId ? await library.saveStore(playId, activeId).loadHistory() : [];
      return json(res, 200, { beats });
    }
    if (sub === "lineage" && parts.length === 4) {
      // 路线树（P6）：全量节点（含废弃分支）；打开路线视图/结构操作后/手动刷新时取
      if (method !== "GET") return fail(res, 405, "不支持的方法");
      const runtime = await playhouse.get(playId);
      return json(res, 200, runtime.orchestrator.lineageView());
    }

    // —— 存档（周目）：一剧目并存 N 棵独立的谱系树，「开始新周目」只新建不覆盖 ——
    if (sub === "saves" && parts.length === 4) {
      if (method === "GET") return json(res, 200, await library.saves(playId).list());
      if (method === "POST") {
        const raw = await readBody(req);
        const body = raw.length ? (JSON.parse(raw.toString("utf8")) as { name?: string }) : {};
        return json(res, 200, await playhouse.createSave(playId, body.name));
      }
      return fail(res, 405, "不支持的方法");
    }
    if (sub === "saves" && parts.length === 5) {
      const saveId = parts[4] ?? "";
      if (method === "PATCH") {
        const body = JSON.parse((await readBody(req)).toString("utf8")) as { name?: string };
        if (!body.name?.trim()) return fail(res, 400, "档名不能为空");
        return json(res, 200, await playhouse.renameSave(playId, saveId, body.name));
      }
      if (method === "DELETE") {
        await playhouse.deleteSave(playId, saveId);
        return json(res, 200, { ok: true });
      }
    }

    if (sub === "active" && parts.length === 4 && method === "PUT") {
      // 切档：只改指针 + 重建 runtime；演出进行中等当前一轮演完
      const body = JSON.parse((await readBody(req)).toString("utf8")) as { saveId?: string };
      if (!body.saveId) return fail(res, 400, "缺少 saveId");
      await playhouse.switchSave(playId, body.saveId);
      return json(res, 200, { ok: true });
    }

    if (sub === "play" && parts.length === 4) {
      if (method !== "PUT") return fail(res, 405, "不支持的方法");
      const play = parsePlayConfig(JSON.parse((await readBody(req)).toString("utf8")));
      // 手动保存也是全量读改写，和导入/出图抢的是同一份 play.json
      await withPlayConfigLock(store.dir, () => store.savePlay(play));
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
    // —— 创作口径（craft.md）：一等公民读写口，默认为空（内置准则在系统提示词里）——
    if (sub === "craft" && parts.length === 4) {
      const runtime = await playhouse.get(playId);
      if (method === "GET") {
        return json(res, 200, { content: await runtime.workshop.files.read(CRAFT_PATH).catch(() => "") });
      }
      if (method === "PUT") {
        const body = JSON.parse((await readBody(req)).toString("utf8")) as { content?: string };
        if (typeof body.content !== "string") return fail(res, 400, "缺少 content");
        await runtime.workshop.writeFile(CRAFT_PATH, body.content);
        return json(res, 200, { ok: true });
      }
      return fail(res, 405, "不支持的方法");
    }
    // —— 世界观前提（premise.md）：与 craft 同层的另一个一等公民，改完立刻重建 runtime ——
    if (sub === "premise" && parts.length === 4) {
      const runtime = await playhouse.get(playId);
      if (method === "GET") return json(res, 200, { content: await store.premise() });
      if (method === "PUT") {
        const body = JSON.parse((await readBody(req)).toString("utf8")) as { content?: string };
        if (typeof body.content !== "string") return fail(res, 400, "缺少 content");
        // 走工坊的 writeFile：它已经把「写盘 → 撤销条 → 等节拍边界再重建 runtime」串好了
        await runtime.workshop.writeFile(PREMISE_PATH, body.content);
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
    if (sub === "assets" && parts[4] === "import" && parts.length === 5) {
      // 从资源库导入（复制进本剧目 + 写素材表/角色卡），同素材上传一样：保存即生效
      if (method !== "POST") return fail(res, 405, "不支持的方法");
      if (!assets) return fail(res, 404, "资源库未启用");
      const body = JSON.parse((await readBody(req)).toString("utf8")) as {
        kind?: string;
        entryId?: string;
        expressions?: string[];
        target?: string;
      };
      if (!body.entryId) return fail(res, 400, "缺少 entryId");
      if (!body.kind || !(ASSET_KINDS_LIST as readonly string[]).includes(body.kind)) {
        return fail(res, 400, `未知素材类别: ${body.kind ?? ""}`);
      }
      if (body.target !== undefined && body.target !== "protagonist") {
        return fail(res, 400, `未知导入落点: ${body.target}`);
      }
      const result = await importFromLibrary(assets, store, {
        kind: body.kind as AssetKind,
        entryId: body.entryId,
        ...(Array.isArray(body.expressions) && body.expressions.length > 0
          ? { expressions: body.expressions }
          : {}),
        ...(body.target ? { target: "protagonist" as const } : {}),
      });
      await playhouse.reload(playId);
      return json(res, 200, result);
    }
    if (sub === "assets" && parts[4] === "meta" && parts.length === 5) {
      // 素材元数据表（stem → 描述/标签/情绪…）：素材页显示副标题用，剧作家提示词也吃这一份
      if (method !== "GET") return fail(res, 405, "不支持的方法");
      return json(res, 200, await store.assetMeta());
    }
    if (sub === "cg" && parts.length === 4) {
      // CG 页的台账：静态素材（assets/cg，带素材表描述）+ 站内生成的图（带生图 prompt）。
      // 两份生成台账并进来：剧作家预发射落在 media-cache/img/manifest.json，工坊与剧作家的
      // generate_image 落在 assets/generated.json（进 git，跟着静态素材走）。
      // 只读盘上已有的东西：不建 runtime、不触发生图——这一页只为看图，不该牵动演出那条线。
      if (method !== "GET") return fail(res, 405, "不支持的方法");
      const [meta, assets, generated, ledger] = await Promise.all([
        store.assetMeta(),
        store.listAssets(),
        readGeneratedEntries(playId, store),
        readPlayLedgerEntries(playId, store),
      ]);
      return json(res, 200, { entries: cgCatalog(playId, assets.cg ?? [], meta, [...generated, ...ledger]) });
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
