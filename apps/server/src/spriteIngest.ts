import { declareSprite, persistAsset, spriteRefOfPath, type AssetRef } from "@aivn/agent";
import type { SpriteFraming } from "@aivn/core";
import { assetIoOf, readManifest, writeManifest } from "./assetFiles.js";
import { prepareSprite, resolveTuning, type CutoutTuning } from "./cutout.js";
import type { PlayFiles } from "./playFiles.js";
import { withPlayConfigLock, type PlayStore } from "./store.js";

/**
 * **立绘入库的唯一写口。**
 *
 * 立绘能不能在舞台上摆正，靠的是一个不变量：画布比跟着该差分的 `framing`、顶部留白固定 5%、
 * 人物缩到画布高 95%，两个落位指标（`figureTop` / `figureHeight`）进素材表。这个不变量原先散在
 * 六条写口里（出图入库、抠底、`import_asset`、资源库导入、素材页上传、原地重抠），只有两条做对了，
 * 于是同一个剧里不同差分的头顶会漂。凡是「把一张立绘图写进 `assets/sprites/`」都从这里过：
 * 归一化（`prepareSprite`，纯色底原片去底、已抠好的透明 PNG 直接重排画布）→ 落盘 → 指标进表。
 *
 * 出图那两条路（`draft` → `commit`、`import_asset`）不在这里落盘：它们的写盘与记账走
 * `@aivn/agent` 的两条入库流水线（`adoptDraft` / `registerAsset`），**归一化在交给它们之前做完**
 * （见 `PlayAssets` 的 `normalizeSprite`）。三条路共用同一个 `prepareSprite`，不变量因此只有一份实现。
 */
export interface SpriteIngestRequest {
  spriteId: string;
  variant: string;
  /** 立绘图：纯色键底的原片，或已经抠好底的透明 PNG。 */
  bytes: Buffer;
  /** 该差分的取景（决定画布比）。不给按缺省（全身 9:16）。 */
  framing?: SpriteFraming;
  /** 去底那五个旋钮（只影响色键那一支）。 */
  tuning?: Partial<CutoutTuning>;
}

export interface IngestedSprite {
  /** 剧目内相对路径（`assets/sprites/<主体>/<差分>.png`）。 */
  path: string;
  figureTop: number;
  figureHeight: number;
  /** 前景像素占比（回执的抠底体检用）。 */
  coverage: number;
  replaced: boolean;
}

/**
 * `assets/sprites/` 下只认 `sprites/<主体>/<差分>.<扩展名>` 这一种落位：立绘的身份就是这两段，
 * 少一段或深一层都没有东西寻址得到它（舞台按 `<主体>/<差分>` 找文件，素材表也按这两段落键）。
 * 落在这一形状之外的一律拒绝——**要么它是立绘（走 `ingestSprite`）、要么它不该放在这个目录里**，
 * 不能留下第二张没有指标的图。
 */
export function assertSpriteLanding(rel: string): void {
  if (!rel.startsWith("assets/sprites/") || spriteRefOfPath(rel)) return;
  throw new Error(
    `立绘落位是 assets/sprites/<主体>/<差分>.<扩展名>（收到 ${rel}）：` +
      "舞台与素材表都按这两段寻址，这个目录下不收别的形状。",
  );
}

/** 归一化 → 落盘 → 落位指标进素材表。**立绘入库只走这一条**。 */
export async function ingestSprite(
  deps: { store: PlayStore; files: PlayFiles },
  request: SpriteIngestRequest,
): Promise<IngestedSprite> {
  const prepared = await prepareSprite(request.bytes, {
    framing: request.framing,
    tuning: resolveTuning(request.tuning),
  });
  // 落位规则（`assets/sprites/<主体>/<差分>.png` + 清掉同 stem 的旧扩展名）与两个流水线共用一份
  const spec: AssetRef & { figureTop: number; figureHeight: number } = {
    kind: "sprite",
    kindPath: `sprites/${request.spriteId}`,
    stem: request.variant,
    spriteId: request.spriteId,
    variant: request.variant,
    ...(request.framing ? { framing: request.framing } : {}),
    figureTop: prepared.figureTop,
    figureHeight: prepared.figureHeight,
  };
  const written = await persistAsset(assetIoOf(deps.files), spec, prepared.data, ".png");
  // 声明规则（neutral 立绘级、非 neutral 差分级覆盖）也只有一份，在 catalog 里
  await withPlayConfigLock(deps.store.dir, async () => {
    await writeManifest(deps.files, declareSprite(await readManifest(deps.files), spec));
  });
  return {
    path: written.rel,
    figureTop: prepared.figureTop,
    figureHeight: prepared.figureHeight,
    coverage: prepared.coverage ?? 0,
    replaced: written.replaced,
  };
}
