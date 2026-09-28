import type { PlayConfig } from "@stage-ai/core";

/** 素材名 → URL 解析（stem 无扩展名时按目录清单补全；缺素材返回 null 走降级）。 */
export interface AssetIndex {
  bg: (stem: string | null) => string | null;
  cg: (id: string | null) => string | null;
  bgm: (stem: string | null) => string | null;
  sfx: (src: string | null) => string | null;
  sprite: (charId: string, expression: string | null) => string | null;
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
): AssetIndex {
  const bg = stemMap(assets.backgrounds);
  const cg = stemMap(assets.cg);
  const bgm = stemMap(assets.bgm);
  const sfx = stemMap(assets.sfx);
  const url = (dir: string, file: string): string => `/plays/${playId}/assets/${dir}/${file}`;
  const byStem = (map: Map<string, string>, dir: string) => (stem: string | null) => {
    const file = stem ? map.get(stem) : undefined;
    return file ? url(dir, file) : null;
  };

  return {
    bg: byStem(bg, "backgrounds"),
    cg: byStem(cg, "cg"),
    bgm: byStem(bgm, "bgm"),
    sfx: byStem(sfx, "sfx"),
    sprite: (charId, expression) => {
      const character = play.characters.find((c) => c.id === charId);
      const mapped = expression ? character?.sprites?.[expression] : undefined;
      if (mapped) return url(`sprites/${charId}`, mapped);
      const files = assets[`sprites/${charId}`] ?? [];
      return files[0] ? url(`sprites/${charId}`, files[0]!) : null;
    },
  };
}
