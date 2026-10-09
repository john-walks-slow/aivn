/**
 * **素材引用**：用一个短字符串指向剧目里已经落成的东西（`sprite:lin/neutral`）。
 *
 * 为什么要有它：宿主手里（或留底库里）本来就有这些图，让模型自己拼 `media-cache/sprite-sources/lin/neutral.png`
 * 等于把宿主的内部布局写进提示词——路径一改就静默失效，模型还得先知道它。引用只表达「我要哪张素材」，
 * 怎么找到它、找不到怎么办，是宿主的事。
 *
 * 语法（`kind:名称`，立绘多一段差分）：
 * - `sprite:<spriteId>` / `sprite:<spriteId>/<variant>`（差分不给按 `neutral`）
 * - `background:<name>` / `cg:<name>`
 *
 * 与「按形状识别的垫图」同一族约定（主体 id / 剧目内相对路径 / http(s) 网址）：**不含 `:` 的一律当路径**，
 * 所以老的调用一字不用改。
 */
import type { AssetKind } from "./catalog.js";

/** 引用能表达的那点身份（比完整落位少：取景 / 体量 / 标题是声明，不是寻址）。 */
export interface AssetRefParts {
  kind: AssetKind;
  name?: string;
  spriteId?: string;
  variant?: string;
}

const KINDS: readonly AssetKind[] = ["background", "cg", "sprite"];

/** 落位 → 引用串（宿主的回执里给模型「下次这么引用」用）。 */
export function formatAssetRef(target: AssetRefParts): string {
  if (target.kind === "sprite") {
    const id = target.spriteId ?? target.name ?? "";
    const variant = target.variant?.trim();
    return `sprite:${id}${variant && variant !== "neutral" ? `/${variant}` : ""}`;
  }
  return `${target.kind}:${target.name ?? ""}`;
}

/**
 * 引用串 → 身份；**不是引用就返回 null**（调用方当路径处理）。
 *
 * 认得出前缀但名称不合法时当场报错，而不是掉回路径分支——那样报出来的是「找不到文件」，
 * 把一个语法错误伪装成文件缺失。
 */
export function parseAssetRef(text: string): AssetRefParts | null {
  const raw = text.trim();
  const at = raw.indexOf(":");
  if (at <= 0) return null;
  const kind = raw.slice(0, at);
  if (!KINDS.includes(kind as AssetKind)) return null;

  const rest = raw.slice(at + 1).trim();
  if (!rest) throw new Error(`素材引用缺名称：${raw}（要 ${kind}:<名称>）`);

  if (kind === "sprite") {
    const [id, variant, ...extra] = rest.split("/");
    if (!id?.trim()) throw new Error(`立绘引用缺主体 id：${raw}（要 sprite:<主体id>[/<差分名>]）`);
    if (extra.length > 0) throw new Error(`立绘引用多了层级：${raw}（要 sprite:<主体id>[/<差分名>]）`);
    return {
      kind: "sprite",
      spriteId: id.trim(),
      variant: variant?.trim() || "neutral",
    };
  }

  if (rest.includes("/")) throw new Error(`${kind} 引用不该带斜杠：${raw}（要 ${kind}:<名称>）`);
  return { kind: kind as AssetKind, name: rest };
}

/** 给模型看的那句语法说明（工具的 `source` 字段共用一份）。 */
export const ASSET_REF_HINT =
  "也可以直接给**素材引用**：`sprite:<主体id>[/<差分名>]` / `background:<名称>` / `cg:<名称>`" +
  "——剧目里/留底库里已有的素材，宿主自己去找那张图，别自己拼路径。";
