import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { parsePlayAssetManifest } from "@aivn/core";
import { IMAGE_EXTS, type AssetIo, type AssetManifest } from "@aivn/agent";
import type { PlayFiles } from "./playFiles.js";

/**
 * 素材落盘的两个原语：`AssetIo` 与素材表（`assets/manifest.json`）的读写。
 *
 * 放在一处是因为「谁都能拼一个 AssetIo」正是立绘写口散成六份的原因——落位、旧扩展名清理、
 * 素材表格式（旧格式里值是一句字符串）三件事各写一遍，就会出现「有的口清旧文件、有的不清」
 * 「有的口读得懂旧格式、有的把字符串 spread 成对象」。写口白名单仍然只有 `PlayFiles` 一处。
 *
 * 素材表是「读全量 → 改 → 写回」，**调用方必须自己持 `withPlayConfigLock`**：这里只认字节与 JSON，
 * 不认锁，也不推刷新信号（工坊那条通道归 `PlayAssets`）。
 */
export function assetIoOf(files: PlayFiles): AssetIo {
  return {
    list: async (kindPath) => {
      const dir = files.absoluteOf(`assets/${kindPath}`);
      if (!existsSync(dir)) return [];
      return (await readdir(dir)).filter((name) => IMAGE_EXTS.some((ext) => name.endsWith(ext)));
    },
    write: async (rel, data) => {
      await files.writeBinary(rel, data);
    },
    remove: (rel) => files.removeAsset(rel),
  };
}

/** 素材表：没有、坏 JSON、旧格式（值是一句字符串）都收成同一张表。 */
export function parseManifest(raw: string): AssetManifest {
  if (!raw.trim()) return {};
  try {
    return parsePlayAssetManifest(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** 读素材表（读盘 + `parseManifest`）。 */
export async function readManifest(files: PlayFiles): Promise<AssetManifest> {
  return parseManifest(await files.read("assets/manifest.json").catch(() => ""));
}

/** 素材表落盘：缩进两格、末尾换行（表是给人读也给人改的）。 */
export async function writeManifest(files: PlayFiles, manifest: AssetManifest): Promise<void> {
  await files.write("assets/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
}

