import { useCallback, useEffect, useMemo, useState } from "react";
import type { AssetKind, AssetMeta } from "@stage-ai/core";
import { api, assetUrl, type PlayDetail } from "../api.js";
import { Icon } from "../ui/Icon.js";
import { ImageLightbox } from "../ui/ImageLightbox.js";
import { LibraryBrowser } from "./LibraryBrowser.js";

const KINDS = ["backgrounds", "cg", "sfx", "bgm"] as const;

/** 文件名去掉扩展名：素材表与文件名对不上时，仍能按 stem 找到描述。 */
const stemOf = (name: string): string => name.replace(/\.\w+$/, "");

/** 素材：背景、CG、音效、配乐的上传与从资源库导入。剧目字段与角色卡在「设定与记忆」页。 */
export function AssetsPanel({ playId }: { playId: string }) {
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [assets, setAssets] = useState<Record<string, string[]>>({});
  const [assetMeta, setAssetMeta] = useState<Record<string, AssetMeta>>({});
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ url: string; name: string } | null>(null);
  /** 资源库导入的落点：null = 面板关闭，"" = 素材（无落点）。 */
  const [libraryInto, setLibraryInto] = useState<string | null>(null);

  const reload = useCallback((): void => {
    api
      .playDetail(playId)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
    api.listAssets(playId).then(setAssets).catch(() => {});
    api.assetMeta(playId).then(setAssetMeta).catch(() => {});
  }, [playId]);
  useEffect(reload, [reload]);

  const upload = (kind: string, file: File): void => {
    api
      .uploadAsset(playId, kind, file.name, file)
      .then(reload)
      .catch((e: Error) => setError(e.message));
  };

  const remove = (kind: string, name: string): void => {
    if (!window.confirm(`删除 ${kind}/${name}？`)) return;
    api
      .deleteAsset(playId, kind, name)
      .then(reload)
      .catch((e: Error) => setError(e.message));
  };

  const readiness = detail?.readiness;
  const missingAssets = readiness
    ? [
        ...(readiness.characterSprites ? [] : ["角色立绘"]),
        ...(readiness.background ? [] : ["背景图"]),
      ]
    : [];
  const spritesDirs = Object.keys(assets).filter((k) => k.startsWith("sprites/"));
  /** 剧目里已有的条目：立绘按角色目录（目录名即条目 id），其余按 stem。 */
  const owned = useMemo(() => {
    const set = new Set<string>();
    for (const kind of KINDS) for (const name of assets[kind] ?? []) set.add(`${kind}/${stemOf(name)}`);
    for (const dir of spritesDirs) set.add(`sprites/${dir.slice("sprites/".length)}`);
    return set;
  }, [assets, spritesDirs]);

  const isImported = (kind: AssetKind, id: string): boolean => owned.has(`${kind}/${id}`);
  /** 素材行的副标题：素材表里的描述（剧作家在提示词里看到的是同一句）。 */
  const noteFor = (dir: string, name: string): string | null => {
    const stem = stemOf(name);
    const key = dir.startsWith("sprites/") ? `${dir.slice("sprites/".length)}/${stem}` : stem;
    // 立绘的键有两套约定并存的现实：规范的 <角色id>/<差分名> 与旧表的裸差分名。
    // 规范那条可能只有引擎记的 prompt 没有描述，回落到裸名，别显示成「没有描述」。
    const legacy = key === stem ? undefined : assetMeta[stem]?.description;
    return assetMeta[key]?.description ?? legacy ?? null;
  };

  return (
    <div className="workshop-tab-pane assets-pane">
      {readiness && (
        <div className="assets-pane-head">
          <span className={`badge ${missingAssets.length === 0 ? "ok" : ""}`}>
            {missingAssets.length === 0 ? "素材齐了" : `还没有 ${missingAssets.join("、")}`}
          </span>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <section className="panel">
        <div className="assets-section-head">
          <h3>素材</h3>
          <button
            className="ghost-btn"
            onClick={() => setLibraryInto("")}
            title="从应用级资源库挑素材复制进本剧目"
          >
            <span className="btn-icon">
              <Icon name="download" size={14} /> 从资源库导入
            </span>
          </button>
        </div>
        <div className="upload-grid">
          {KINDS.map((kind) => (
            <div key={kind} className="upload-cell">
              <strong>{kind}</strong>
              <label className="btn-as-label small">
                上传
                <input
                  type="file"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload(kind, file);
                  }}
                />
              </label>
              <ul className="asset-list">
                {(assets[kind] ?? []).map((name) => (
                  <AssetRow
                    key={name}
                    playId={playId}
                    dir={kind}
                    name={name}
                    note={noteFor(kind, name)}
                    onRemove={() => remove(kind, name)}
                    onZoom={() => setZoom({ url: assetUrl(playId, kind, name), name })}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {zoom && (
        <ImageLightbox
          images={[{ url: zoom.url, caption: zoom.name }]}
          index={0}
          onIndex={() => {}}
          onClose={() => setZoom(null)}
        />
      )}
      {libraryInto !== null && (
        <LibraryBrowser
          playId={playId}
          imported={isImported}
          onClose={() => setLibraryInto(null)}
          onImported={reload}
        />
      )}
    </div>
  );
}

/** 素材行：图片给缩略图（点开看大图），音频给播放键，其余给占位图标。 */
function AssetRow({
  playId,
  dir,
  name,
  label,
  note,
  onRemove,
  onZoom,
}: {
  playId: string;
  dir: string;
  name: string;
  label?: string;
  /** 素材表里的描述：与剧作家提示词里看到的是同一句。 */
  note?: string | null;
  onRemove: () => void;
  onZoom: () => void;
}) {
  const url = assetUrl(playId, dir, name);
  const isImage = /\.(png|jpe?g|webp|gif)$/i.test(name);
  const isAudio = /\.(mp3|ogg|wav|m4a)$/i.test(name);
  const text = label ?? name;

  return (
    <li className="asset-row">
      {isImage ? (
        <button className="asset-thumb" onClick={onZoom} title="点击看大图">
          <img src={url} alt={text} loading="lazy" />
        </button>
      ) : isAudio ? (
        <audio className="asset-audio" src={url} controls preload="none" />
      ) : (
        <span className="asset-thumb asset-thumb-blank" title={text}>
          <Icon name="assets" size={16} />
        </span>
      )}
      <span className="asset-name" title={note ? `${text}——${note}` : text}>
        {text}
        {note && <em className="asset-note">{note}</em>}
      </span>
      <button className="link-btn" onClick={onRemove}>
        删除
      </button>
    </li>
  );
}
