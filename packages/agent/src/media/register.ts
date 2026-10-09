/**
 * 「登记」use case：把一张**外来的图**（候选、别的工具产出的、下载的）正式入库——
 * 写 `assets/`、补素材表声明与描述、记台账、把抠底前原片搬进 `media-cache/sprite-sources/`。
 *
 * 与 `adoptDraft` 的分工：采用走「草稿出图时的意图」（`draft.json` 里记的身份），
 * 登记走**调用方显式给的落位**——所以同一条流水线服务两种来源，宿主不必为它们各写一遍。
 * 字节由宿主读（路径白名单、SSRF 防护、剧目锁都是宿主的事），这里只按规格落盘与记账。
 */
import {
  declareDescription,
  declareSprite,
  keepSpriteSource,
  ledgerEntryOf,
  persistAsset,
  type AssetIo,
  type AssetManifest,
  type AssetRef,
  type LedgerEntry,
} from "./catalog.js";
import type { AdoptHost, AdoptedAsset } from "./adopt.js";

/** 一份读好的来源（宿主负责把它从路径或网址读成字节，并认出扩展名）。 */
export interface AssetSource {
  bytes: Buffer;
  /** 带点的扩展名（`.png`）。 */
  ext: string;
}

export interface RegisterAssetInput {
  image: AssetSource;
  /** 立绘抠底**前**的原片：给了就留底（日后原地重抠）。 */
  original?: AssetSource;
  description?: string;
  prompt?: string;
}

/** 登记一张图（调用方负责把落位解析成规格、把来源读成字节）。 */
export async function registerAsset(host: AdoptHost, spec: AssetRef, input: RegisterAssetInput): Promise<AdoptedAsset> {
  // 留底跟着入库：重抠只认 media-cache/sprite-sources/ 那一份。
  const sourceRel =
    spec.kind === "sprite" && input.original
      ? await keepSpriteSource(host.playDir, spec, input.original.bytes, input.original.ext)
      : null;

  const written = await persistAsset(host.assets, spec, input.image.bytes, input.image.ext);
  if (spec.kind === "sprite") await host.updateManifest((manifest) => declareSprite(manifest, spec));
  if (input.description?.trim()) {
    await host.updateManifest((manifest) => declareDescription(manifest, spec, input.description!.trim()));
  }
  await host.recordLedger(ledgerEntryOf(spec, written.rel, (input.prompt ?? "").trim(), new Date().toISOString()));
  return { ...written, sourceRel };
}
