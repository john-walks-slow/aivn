import {
  DEFAULT_SPRITE_FRAMING,
  DEFAULT_SPRITE_STATURE,
  spriteDeclarationOf,
  type ActorAnchor,
  type AssetMeta,
  type SpriteFraming,
  type SpriteStature,
} from "@aivn/core";
import type { GeneratedImage } from "./generatedAssets.js";

/** 立绘的呈现三轴（已带缺省）：舞台按它算缩放与落位。 */
export interface SpritePresentation {
  framing: SpriteFraming;
  stature: SpriteStature;
  anchor: ActorAnchor;
}

/** 素材名 → URL 解析（stem 无扩展名时按目录清单补全；缺素材返回 null 走降级）。 */
export interface AssetIndex {
  bg: (stem: string | null) => string | null;
  cg: (id: string | null) => string | null;
  bgm: (stem: string | null) => string | null;
  sfx: (src: string | null) => string | null;
  /** 环境底音：sfx 与 bgm 两处都放得下循环音（`rain_loop` 归 sfx，`bgm_rainy_night` 归 bgm），都认。 */
  ambient: (stem: string | null) => string | null;
  /** 立绘：按差分名（= 文件名 stem）找那张图，找不到退回目录第一张。 */
  sprite: (spriteId: string, variant: string | null) => string | null;
  /** 有立绘的主体 id（`assets/sprites/` 下的目录名）——「谁能当参考垫图」的唯一真相源。 */
  spriteIds: readonly string[];
  /** 立绘呈现：素材表的差分级声明 → 立绘级声明 → 缺省。 */
  spritePresentation: (spriteId: string, variant: string | null) => SpritePresentation;
}

function stemMap(files: string[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of files ?? []) {
    const idx = file.lastIndexOf(".");
    map.set(idx === -1 ? file : file.slice(0, idx), file);
  }
  return map;
}

/**
 * 素材索引：把剧目素材清单（`GET /api/plays/:id/assets` 的目录 → 文件名）与素材表
 * （`assets/manifest.json`，取景/体量/对齐的声明）合成演出层要的两个查询。
 *
 * 不查角色卡：立绘是独立素材，机甲、道具没有卡也照样上台。主体名另有回落链
 * （卡 name → `<say name>` → 立绘 title → id），不在这层。
 */
export function buildAssetIndex(
  playId: string,
  assets: Record<string, string[]>,
  generated: Record<string, GeneratedImage> = {},
  manifest: Record<string, AssetMeta> = {},
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
    spriteIds: Object.keys(assets)
      .filter((key) => key.startsWith("sprites/") && (assets[key]?.length ?? 0) > 0)
      .map((key) => key.slice("sprites/".length))
      .sort(),
    sprite: (spriteId, variant) => {
      const files = assets[`sprites/${spriteId}`] ?? [];
      const file = (variant ? stemMap(files).get(variant) : undefined) ?? files[0];
      return file ? url(`sprites/${spriteId}`, file) : null;
    },
    spritePresentation: (spriteId, variant) => {
      const declared = spriteDeclarationOf(manifest, spriteId, variant ?? undefined);
      return {
        framing: declared.framing ?? DEFAULT_SPRITE_FRAMING,
        stature: declared.stature ?? DEFAULT_SPRITE_STATURE,
        anchor: declared.anchor ?? "bottom",
      };
    },
  };
}
