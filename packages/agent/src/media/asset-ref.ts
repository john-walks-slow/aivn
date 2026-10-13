/**
 * **已入库立绘识别**：从 `assets/sprites/<spriteId>/<variant>.<ext>` 路径认出立绘身份。
 *
 * 为什么要有它：`cut` 对着已入库的立绘原地重抠时，模型直接传该立绘在剧目里的相对路径
 * `assets/sprites/<主体id>/<差分名>.png`，不必自己拼 `media-cache/sprite-sources/...` 的内部留底路径、
 * 也不必再学一套 `sprite:<id>` 冒号语法。
 */
import type { AssetKind } from "./catalog.js";

/** 已入库立绘的身份（供 `cut` 去留底库取抠底前原片）。 */
export interface AssetRefParts {
  kind: AssetKind;
  name?: string;
  spriteId?: string;
  variant?: string;
}

/**
 * 路径 → 已入库立绘身份；不是 `assets/sprites/<主体id>/<差分名>.<ext>` 就返回 null（按普通源图路径处理）。
 */
export function parseAssetRef(text: string): AssetRefParts | null {
  const raw = text.trim();
  const spritePath = /^(?:\.\/)?assets\/sprites\/([^/]+)\/([^/.]+)\.[a-z0-9]+$/i.exec(raw);
  if (!spritePath) return null;
  return {
    kind: "sprite",
    spriteId: spritePath[1]!,
    variant: spritePath[2]!,
  };
}

/** 给模型看的那句说明（工具的 `source` 字段共用一份）。 */
export const ASSET_REF_HINT =
  "原地重抠已入库的立绘时，直接给该立绘的路径 `assets/sprites/<主体id>/<差分名>.png`——" +
  "宿主会自动拿它留底的抠底前原片重跑。";
