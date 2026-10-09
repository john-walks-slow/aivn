/**
 * 「采用」use case：把一份草稿正式**入库**——写 `assets/`、补素材表声明、记生图台账、
 * 把留底原片搬进 `media-cache/sprite-sources/`。
 *
 * 落位用**草稿出图时的意图**（`draft.json` 里记的那点身份），候选之间的差别在画面不在身份；
 * 同一张草稿重复入库只是把同一个文件再写一遍，幂等（`replaced` 如实为真）。
 *
 * 谁是「剧目目标」不归这里管：垫图基准、取景声明、角色卡都是宿主的事，宿主把草稿解析成
 * `spec` 再交给这条流水线。队列与通知也一样留在宿主。
 */
import {
  declareSprite,
  ledgerEntryOf,
  persistAsset,
  keepSpriteSource,
  type AssetIo,
  type AssetManifest,
  type AssetRef,
  type LedgerEntry,
} from "./catalog.js";
import { markCommitted, readDraftImage, readDraftSource, type DraftRecord } from "./draft.js";

/** 采用一张草稿要用的宿主口子：目录 + 素材写口 + 两张表的读改写（宿主的锁在里面）。 */
export interface AdoptHost {
  /** 剧目根（绝对路径）。 */
  playDir: string;
  assets: AssetIo;
  /** 素材表读改写（`assets/manifest.json`）。 */
  updateManifest(mutate: (manifest: AssetManifest) => AssetManifest): Promise<void>;
  /** 台账写一条（`assets/generated.json`）。 */
  recordLedger(entry: LedgerEntry): Promise<void>;
}

/** 采用回执：落位 + 是否覆盖了既有素材 + 留底原片的剧目内相对路径（没有则 null）。 */
export interface AdoptedAsset {
  rel: string;
  replaced: boolean;
  sourceRel: string | null;
}

/**
 * 把一张草稿正式入库（调用方负责把草稿解析成落位规格）。
 *
 * `imageOverride` 给「入库前还要对字节加工一道」的宿主用：服务端拿它给立绘补抠底
 *（候选不抠底是 P5-c 定的，入库那张必须是透明 PNG）。
 */
export async function adoptDraft(
  host: AdoptHost,
  draft: DraftRecord,
  spec: AssetRef,
  imageOverride?: { bytes: Buffer; ext: string },
): Promise<AdoptedAsset> {
  const bytes = imageOverride?.bytes ?? (await readDraftImage(host.playDir, draft.draftId, draft.imageExt));
  // 留底跟着入库：重抠只认 media-cache/sprite-sources/ 那一份。
  const sourceRel =
    spec.kind === "sprite" && draft.sourceExt
      ? await keepSpriteSource(
          host.playDir,
          spec,
          await readDraftSource(host.playDir, draft.draftId, draft.sourceExt),
          draft.sourceExt,
        )
      : null;

  const written = await persistAsset(host.assets, spec, bytes, imageOverride?.ext ?? draft.imageExt);
  if (spec.kind === "sprite") await host.updateManifest((manifest) => declareSprite(manifest, spec));
  // 台账记的是**这张图当初的 prompt 原文**，不是这次采用时又写的一句话。
  await host.recordLedger(ledgerEntryOf(spec, written.rel, draft.prompt, new Date().toISOString()));
  await markCommitted(host.playDir, draft.draftId, draft);
  return { ...written, sourceRel };
}
