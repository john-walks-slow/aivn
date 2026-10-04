import type { WorkshopAssetView } from "@aivn/core";

/** 素材类别 → 灯箱只看图：bgm/sfx 在对话流里给播放器，不进灯箱。 */
const AUDIO_ASSET = new Set<WorkshopAssetView["kind"]>(["bgm", "sfx"]);

/**
 * 对话流里的素材条：图给缩略图（点开灯箱），音乐/音效给就地播放的播放器——
 * 导入音素材时用户要能当场听一句确认，摆在对话里最省事。
 */
export function AssetStrip({
  assets,
  onOpen,
  bare,
}: {
  assets: WorkshopAssetView[];
  onOpen: (images: WorkshopAssetView[], index: number) => void;
  /** 外层已经带了 asset-strip（pending 态还要那个 .pending 修饰）时不再包一层。 */
  bare?: boolean;
}) {
  const pictures = assets.filter((a) => !AUDIO_ASSET.has(a.kind));
  const body = assets.map((asset, j) =>
    AUDIO_ASSET.has(asset.kind) ? (
      <audio
        key={`${asset.path}-${j}`}
        className="asset-audio"
        src={asset.url}
        controls
        preload="none"
        title={asset.path}
      />
    ) : (
      <button
        key={`${asset.path}-${j}`}
        className="asset-thumb"
        onClick={() => onOpen(pictures, pictures.indexOf(asset))}
        title={asset.path}
      >
        <img src={asset.url} alt={asset.path} loading="lazy" />
      </button>
    ),
  );
  return bare ? <>{body}</> : <div className="asset-strip">{body}</div>;
}
