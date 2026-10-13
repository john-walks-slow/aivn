import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeForTts } from "@aivn/core";
import { zipSync } from "fflate";
import { standaloneAssetsDirOf } from "./paths.js";

export interface PlayerAssets {
  js: string;
  css: string;
}

/** 读取服务端内置的独立播放器 JS/CSS 静态产物。 */
export async function loadDefaultPlayerAssets(metaUrl = import.meta.url): Promise<PlayerAssets> {
  const dir = standaloneAssetsDirOf(metaUrl);
  const jsPath = join(dir, "standalone-player.js");
  const cssPath = join(dir, "standalone-player.css");
  if (!existsSync(jsPath) || !existsSync(cssPath)) {
    throw new Error("离线播放器资源尚未构建（缺少 standalone-player.js/css），请先运行 pnpm build");
  }
  const js = await readFile(jsPath, "utf8");
  const css = await readFile(cssPath, "utf8");
  return { js, css };
}

/** 演后剧目中需要打包的文件集合（排除无用的草稿、中间切图与 node_modules）。 */
export async function collectPlayedFiles(dir: string): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};

  const walk = async (rel: string): Promise<void> => {
    const abs = join(dir, rel);
    for (const entry of await readdir(abs, { withFileTypes: true })) {
      const name = entry.name;
      // 排除根级无关或临时目录
      if (rel === "" && ["node_modules", ".git"].includes(name)) continue;
      // media-cache 下只保留 tts 音频，排除草稿与中间切片
      if (rel === "media-cache" && ["drafts", "sprite-sources", "web-images"].includes(name)) continue;

      const childRel = rel === "" ? name : `${rel}/${name}`;
      if (entry.isDirectory()) {
        await walk(childRel);
      } else {
        files[childRel] = new Uint8Array(await readFile(join(dir, childRel)));
      }
    }
  };

  await walk("");

  // 构建 voiceMap.json（记录台词 seq -> tts 音频相对路径），让离线播放器直取音频
  const voiceMap = await buildVoiceMap(dir, files);
  if (Object.keys(voiceMap).length > 0) {
    files["voiceMap.json"] = new TextEncoder().encode(JSON.stringify(voiceMap, null, 2));
  }

  return files;
}

/** 遍历角色卡与 session 中的 say 节点，根据 sha1 哈希匹配已生成的 tts 音频。 */
async function buildVoiceMap(
  dir: string,
  files: Record<string, Uint8Array>,
): Promise<Record<number, string>> {
  const voiceMap: Record<number, string> = {};
  const sessionRaw = files["session.json"];
  if (!sessionRaw) return voiceMap;

  let session: any;
  try {
    session = JSON.parse(new TextDecoder().decode(sessionRaw));
  } catch {
    return voiceMap;
  }

  // 读取所有角色卡里的 voiceId
  const voiceIds = new Map<string, string>();
  const charDir = join(dir, "characters");
  if (existsSync(charDir)) {
    try {
      const charFiles = await readdir(charDir);
      for (const cf of charFiles) {
        if (!cf.endsWith(".md")) continue;
        const text = await readFile(join(charDir, cf), "utf8");
        const match = text.match(/voiceId:\s*([^\s\n]+)/);
        if (match?.[1]) {
          const charId = cf.replace(/\.md$/, "");
          voiceIds.set(charId, match[1]);
        }
      }
    } catch {}
  }

  const events = session.lineage?.events ?? [];
  for (const ev of events) {
    if (ev.kind !== "say" || typeof ev.payload?.seq !== "number" || !ev.text) continue;
    const charId = ev.payload?.attrs?.id;
    const voiceId = voiceIds.get(charId);
    if (!voiceId) continue;

    const normalized = normalizeForTts(ev.text.trim());
    const hash =
      createHash("sha1").update(voiceId).update("\0").update(normalized).digest("hex") + ".mp3";
    const ttsPath = `media-cache/tts/${hash}`;
    if (files[ttsPath]) {
      voiceMap[ev.payload.seq] = ttsPath;
    }
  }

  return voiceMap;
}

/** 导出已演剧目 Zip 包。 */
export async function exportPlayedZip(dir: string): Promise<Uint8Array> {
  const files = await collectPlayedFiles(dir);
  return zipSync(files, { level: 6 });
}

/** HTML 转义。 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 导出单文件 HTML 离线播放包。 */
export async function exportPlayedHtml(
  dir: string,
  playId: string,
  playerAssets: PlayerAssets,
): Promise<string> {
  const zipBytes = await exportPlayedZip(dir);
  const base64Zip = Buffer.from(zipBytes).toString("base64");

  let title = playId;
  const playJsonPath = join(dir, "play.json");
  if (existsSync(playJsonPath)) {
    try {
      const playRaw = JSON.parse(await readFile(playJsonPath, "utf8"));
      if (playRaw.title) title = playRaw.title;
    } catch {}
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(title)} - 演出回放</title>
  <style>
${playerAssets.css}
  </style>
</head>
<body>
  <div id="root"></div>
  <script id="aivn-data" type="text/plain">${base64Zip}</script>
  <script>
${playerAssets.js}
  </script>
</body>
</html>`;
}

/** 从 HTML 文件中提取内嵌的 Base64 Zip 数据；若非 HTML 或未找到则返回 null。 */
export function extractZipFromHtml(data: Uint8Array | Buffer): Uint8Array | null {
  const head = data.slice(0, 300).toString("utf8").toLowerCase();
  if (!head.includes("<!doctype") && !head.includes("<html")) {
    return null;
  }
  const text = data.toString("utf8");
  const marker = '<script id="aivn-data" type="text/plain">';
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const contentStart = start + marker.length;
  const end = text.indexOf("</script>", contentStart);
  if (end < 0) return null;
  const b64 = text.slice(contentStart, end).trim();
  return new Uint8Array(Buffer.from(b64, "base64"));
}
