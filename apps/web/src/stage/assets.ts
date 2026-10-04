import {
  DEFAULT_SPRITE_FRAMING,
  DEFAULT_SPRITE_STATURE,
  spriteDeclarationOf,
  spriteIdOf,
  type ActorAnchor,
  type AssetMeta,
  type CharacterDocument,
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
  /**
   * 演员 id → 立绘目录名。卡上写了 `sprite` 就是它，没写（或没有卡）就是同名——
   * 下面几个 `sprite*` 查询吃的都是**目录名**，舞台上拿到的是 `<actor id>`，先过这一层。
   */
  spriteDirOf: (actorId: string) => string;
  /**
   * 立绘目录名 → 这个目录的主体的显示名（被某张卡绑走时是那张卡的名字）；
   * 目录没人认领（机甲、道具、没有卡的主体）时 null，交给名牌回落链。
   */
  spriteName: (spriteId: string) => string | null;
  /** 立绘：按差分名（= 文件名 stem）找那张图，找不到退回目录第一张。参数是**立绘目录名**。 */
  sprite: (spriteId: string, variant: string | null) => string | null;
  /** 有立绘的主体 id（`assets/sprites/` 下的目录名）——「谁能当参考垫图」的唯一真相源。 */
  spriteIds: readonly string[];
  /** 立绘呈现：素材表的差分级声明 → 立绘级声明 → 缺省。参数是**立绘目录名**。 */
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
 * 素材索引：把剧目素材清单（`GET /api/plays/:id/assets` 的目录 → 文件名）、素材表
 * （`assets/manifest.json`，取景/体量/对齐的声明）与角色卡（立绘绑定的唯一出处）合成演出层的查询。
 *
 * 角色卡只用来解**绑定**：一个主体要不要有卡、卡上有没有人设，与立绘没关系——
 * 机甲、道具没有卡也照样上台，所以 `cast` 缺省是空表，那时每个演员都用同名目录。
 * 主体名另有回落链（卡 name → `<say name>` → 立绘 title → id），不在这层。
 */
export function buildAssetIndex(
  playId: string,
  assets: Record<string, string[]>,
  generated: Record<string, GeneratedImage> = {},
  manifest: Record<string, AssetMeta> = {},
  cast: readonly CharacterDocument[] = [],
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
  // 显式绑定表：只有写了 `sprite:` 的卡才占一格，同名（绝大多数）不进表、由 spriteDirOf 直接回落
  const bound = new Map<string, string>();
  // 目录 → 主体名：素材页与参考垫图选择器要按目录反查「这是谁」，同名卡也在这张表里
  const owners = new Map<string, string>();
  for (const card of cast) {
    if (!card.id) continue;
    const dir = spriteIdOf(card.id, card);
    if (dir !== card.id) bound.set(card.id, dir);
    if (!owners.has(dir)) owners.set(dir, card.name ?? card.id);
  }

  return {
    bg: byStem(bg, "backgrounds"),
    cg: byStem(cg, "cg"),
    bgm: byStem(bgm, "bgm"),
    sfx: byStem(sfx, "sfx"),
    ambient: (stem) => byStem(sfx, "sfx")(stem) ?? byStem(bgm, "bgm")(stem),
    spriteDirOf: (actorId) => bound.get(actorId) ?? actorId,
    spriteName: (spriteId) => owners.get(spriteId) ?? null,
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
