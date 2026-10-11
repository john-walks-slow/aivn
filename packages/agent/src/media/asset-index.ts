/**
 * 剧目素材清单：读 `assets/` 目录，给出「有哪些素材」。
 *
 * 形状两个宿主一致：键是素材类别，立绘按主体拆成 `sprites/<id>`；值是该类别下的文件名。
 *
 * 读盘是**同步**的：插件那边系统提示词的段 provider 同步求值、每轮都要用这张表，
 * 而这些都是本机几十字节到几 KB 的小文件——同步读一次的代价远小于为此维护第二份实现
 * （拆分口径漂了，舞台与剧作家看到的素材就不一致了）。
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** 图片与音频扩展名白名单：素材清单与素材页共用同一个口径。 */
export const MEDIA_EXT = /\.(png|jpe?g|webp|mp3|ogg|wav|m4a|flac)$/i;

/** 素材类别目录（顺序即清单里各段的顺序）。 */
const KINDS = ["backgrounds", "cg", "sprites", "bgm", "ambient", "sfx"] as const;

export type AssetIndex = Record<string, string[]>;

/** 剧目里现有的素材：`{backgrounds: [...], "sprites/alice": [...]}`。 */
export function listPlayAssets(dir: string): AssetIndex {
  const root = join(dir, "assets");
  const index: AssetIndex = {};
  if (!existsSync(root)) return index;

  for (const kind of KINDS) {
    const kindDir = join(root, kind);
    if (!existsSync(kindDir)) continue;

    if (kind === "sprites") {
      for (const entry of readdirSync(kindDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        // 排序：找不到指定差分时按第一张兜底，readdir 顺序不定会让兜底每次挑到不同的脸。
        index[`sprites/${entry.name}`] = readdirSync(join(kindDir, entry.name))
          .filter((name) => MEDIA_EXT.test(name))
          .sort((a, b) => a.localeCompare(b));
      }
    } else {
      // 同样排序：素材清单要稳定，两次读到的顺序不该变。
      index[kind] = readdirSync(kindDir)
        .filter((name) => MEDIA_EXT.test(name))
        .sort((a, b) => a.localeCompare(b));
    }
  }
  return index;
}
