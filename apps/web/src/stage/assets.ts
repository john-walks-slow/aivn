import { DEFAULT_SPRITE_FRAMING, type PlayConfig, type SpriteFraming } from "@stage-ai/core";
import type { GeneratedImage } from "./generatedAssets.js";

/** 素材名 → URL 解析（stem 无扩展名时按目录清单补全；缺素材返回 null 走降级）。 */
export interface AssetIndex {
  bg: (stem: string | null) => string | null;
  cg: (id: string | null) => string | null;
  bgm: (stem: string | null) => string | null;
  sfx: (src: string | null) => string | null;
  /** 环境底音：sfx 与 bgm 两处都放得下循环音（`rain_loop` 归 sfx，`bgm_rainy_night` 归 bgm），都认。 */
  ambient: (stem: string | null) => string | null;
  sprite: (charId: string, expression: string | null) => string | null;
  /** 立绘取景（决定舞台站位预设）：差分覆盖 → 角色声明 → 全身。 */
  spriteFraming: (charId: string, expression: string | null) => SpriteFraming;
}

function stemMap(files: string[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of files ?? []) {
    const idx = file.lastIndexOf(".");
    map.set(idx === -1 ? file : file.slice(0, idx), file);
  }
  return map;
}

export function buildAssetIndex(
  playId: string,
  play: PlayConfig,
  assets: Record<string, string[]>,
  generated: Record<string, GeneratedImage> = {},
): AssetIndex {
  const bg = stemMap(assets.backgrounds);
  const cg = stemMap(assets.cg);
  const bgm = stemMap(assets.bgm);
  const sfx = stemMap(assets.sfx);
  const url = (dir: string, file: string): string => `/plays/${playId}/assets/${dir}/${file}`;
  const byStem = (map: Map<string, string>, dir: string) => (stem: string | null) => {
    const file = stem ? map.get(stem) : undefined;
    if (file) return url(dir, file);
    // 静态素材优先（用户导入的是最终资产），缺了才用站内生成的同名 id（D6）
    const gen = stem ? generated[stem] : undefined;
    return gen?.ready ? gen.url : null;
  };

  return {
    bg: byStem(bg, "backgrounds"),
    cg: byStem(cg, "cg"),
    bgm: byStem(bgm, "bgm"),
    sfx: byStem(sfx, "sfx"),
    ambient: (stem) => byStem(sfx, "sfx")(stem) ?? byStem(bgm, "bgm")(stem),
    sprite: (charId, expression) => {
      const character = play.characters.find((c) => c.id === charId);
      const mapped = expression ? character?.sprites?.[expression] : undefined;
      if (mapped) return url(`sprites/${charId}`, mapped);
      const files = assets[`sprites/${charId}`] ?? [];
      return files[0] ? url(`sprites/${charId}`, files[0]!) : null;
    },
    spriteFraming: (charId, expression) => {
      const character = play.characters.find((c) => c.id === charId);
      return (
        (expression ? character?.spriteFraming?.[expression] : undefined) ??
        character?.framing ??
        DEFAULT_SPRITE_FRAMING
      );
    },
  };
}
