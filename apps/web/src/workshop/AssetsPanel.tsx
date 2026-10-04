import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActorAnchor,
  AssetKind,
  AssetMeta,
  GeneratedAsset,
  SpriteFraming,
  SpriteStature,
} from "@aivn/core";
import {
  ACTOR_ANCHORS,
  SPRITE_FRAMINGS,
  SPRITE_FRAMING_LABELS,
  SPRITE_STATURES,
  SPRITE_STATURE_LABELS,
  spriteDeclarationOf,
  spriteTitlesOf,
} from "@aivn/core";
import { api, assetUrl, type PlayDetail } from "../api.js";
import { Icon } from "../ui/Icon.js";
import { ImageLightbox } from "../ui/ImageLightbox.js";
import { LibraryBrowser } from "./LibraryBrowser.js";
import { ImageGenDialog, type ImageGenTarget, type SpriteDirState } from "./ImageGenDialog.js";
import type { RefCandidate } from "../ui/RefCharacterPicker.js";

const KINDS = ["backgrounds", "cg", "sfx", "bgm"] as const;

/** 对齐基准的显示名（DSL 的 anchor 三档，人话版）。 */
const ANCHOR_LABELS: Record<ActorAnchor, string> = { bottom: "贴底", center: "居中", top: "挂顶" };

/** 文件名去掉扩展名：素材表与文件名对不上时，仍能按 stem 找到描述。 */
const stemOf = (name: string): string => name.replace(/\.\w+$/, "");

/** 素材：背景、CG、立绘、音效、配乐的上传与从资源库导入。剧目字段在「剧目」页，角色卡在「角色」页。 */
export function AssetsPanel({
  playId,
  subscribeImageResult,
  subscribeAssetReady,
  focus,
}: {
  playId: string;
  subscribeImageResult?: (handler: (res: any) => void) => () => void;
  /** 注册素材到货回调（返回取消订阅）：助手/舞台那边导进来或画出来的素材，列表要当场跟上。 */
  subscribeAssetReady?: (handler: (asset: GeneratedAsset) => void) => () => void;
  /** 「管立绘」点名的主体：它排在立绘段最前（nonce 让同一个 id 再点一次也生效）。 */
  focus?: { id: string; nonce: number } | null;
}) {
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [assets, setAssets] = useState<Record<string, string[]>>({});
  const [assetMeta, setAssetMeta] = useState<Record<string, AssetMeta>>({});
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ url: string; name: string } | null>(null);
  /** 资源库导入的落点：null = 面板关闭，"" = 素材（无落点）。 */
  const [libraryInto, setLibraryInto] = useState<string | null>(null);
  const [genTarget, setGenTarget] = useState<ImageGenTarget | null>(null);
  /** 「新建立绘」那一行的目录名：与角色卡同名即绑定。 */
  const [newSpriteId, setNewSpriteId] = useState("");
  /** 素材目录读到过没有：落点要等它（挂载那一刻还没有立绘卡可滚）。 */
  const [spritesRead, setSpritesRead] = useState(false);

  const reload = useCallback((): void => {
    api
      .playDetail(playId)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
    api
      .listAssets(playId)
      .then((a) => {
        setAssets(a);
        setSpritesRead(true);
      })
      .catch(() => {});
    api.assetMeta(playId).then(setAssetMeta).catch(() => {});
  }, [playId]);
  useEffect(reload, [reload]);
  // 不是自己发起的到货也要跟上：助手导进来一包立绘、舞台那边引用即导入、后台画完一张
  useEffect(() => subscribeAssetReady?.(() => reload()), [subscribeAssetReady, reload]);

  /**
   * 「管立绘」的落点：滚到那个主体的卡上。
   *
   * 这个主体还没有立绘目录时没有卡可滚——那就滚到「立绘」段头并把它填进新 id 输入框，
   * 上传/出图的那一行就在那儿等着，别让人落在一片没变化的面板上发愣。
   */
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

  /**
   * 写一条呈现声明（null = 摘掉那一格、回到缺省）。
   *
   * 立绘三轴与名牌都落 `assets/manifest.json`：文档与文件同名即绑定，没有映射表要同步。
   */
  const declare = (
    spriteId: string,
    patch: {
      variant?: string | null;
      framing?: SpriteFraming | null;
      stature?: SpriteStature | null;
      anchor?: ActorAnchor | null;
      title?: string | null;
    },
  ): void => {
    api
      .declareSprite(playId, { spriteId, ...patch })
      .then(reload)
      .catch((e: Error) => setError(e.message));
  };

  const readiness = detail?.readiness;
  const missingAssets = readiness
    ? [...(readiness.sprites ? [] : ["立绘"]), ...(readiness.background ? [] : ["背景图"])]
    : [];
  const spriteDirs = Object.keys(assets).filter((k) => k.startsWith("sprites/"));

  /**
   * 「管立绘」点名的主体排在最前。
   *
   * 试过滚动定位：这一页的卡片高度是随图解码陆续长出来的（实测能拖过四秒），
   * 滚动条会被后长出来的内容顶回去，怎么对齐都追不上。把主体排到第一个则与布局无关——
   * 切过来时这一页本来就在顶部，它就在第一屏。
   */
  const orderedDirs = useMemo(() => {
    if (!focus) return spriteDirs;
    const dir = `sprites/${focus.id}`;
    if (!spriteDirs.includes(dir)) return spriteDirs;
    return [dir, ...spriteDirs.filter((d) => d !== dir)];
  }, [spriteDirs, focus]);

  /** 点名的主体还没有立绘目录：把 id 填进「新立绘」那一行，上传/出图就在段头等着。 */
  useEffect(() => {
    if (!focus || !spritesRead) return;
    if (spriteDirs.includes(`sprites/${focus.id}`)) return;
    setNewSpriteId(focus.id);
  }, [focus, spritesRead, spriteDirs]);

  /** 立绘级名牌（素材表 `<id>.title`）：无卡主体在卡上显示、也能当参考垫图的名字。 */
  const spriteTitles = useMemo(() => spriteTitlesOf(assetMeta), [assetMeta]);
  /** 角色卡名字表：立绘只按 id 寻址，有同名卡时在卡上标注一句人名。 */
  const cardNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of detail?.cast ?? []) if (card.id) map.set(card.id, card.name ?? card.id);
    return map;
  }, [detail]);
  /** 名字表：有同名角色卡以卡为准，没有卡就用素材表里的名牌，再没有才落 id。 */
  const nameOf = useCallback(
    (id: string): string => cardNames.get(id) ?? spriteTitles[id] ?? id,
    [cardNames, spriteTitles],
  );
  /** 剧目里已有的条目：立绘按目录（目录名即条目 id），其余按 stem。 */
  const owned = useMemo(() => {
    const set = new Set<string>();
    for (const kind of KINDS) for (const name of assets[kind] ?? []) set.add(`${kind}/${stemOf(name)}`);
    for (const dir of spriteDirs) set.add(`sprites/${dir.slice("sprites/".length)}`);
    return set;
  }, [assets, spriteDirs]);

  const isImported = (kind: AssetKind, id: string): boolean => owned.has(`${kind}/${id}`);
  /** 素材行的副标题：素材表里的描述（剧作家在提示词里看到的是同一句）。 */
  const noteFor = (dir: string, name: string): string | null => {
    const stem = stemOf(name);
    const key = dir.startsWith("sprites/") ? `${dir.slice("sprites/".length)}/${stem}` : stem;
    return assetMeta[key]?.description ?? null;
  };

  /** 参考垫图的候选 = **有立绘**的主体（目录扫出来的）：机甲、道具没有卡也能垫。 */
  const refCandidates: RefCandidate[] = useMemo(
    () =>
      spriteDirs
        .map((dir) => {
          const id = dir.slice("sprites/".length);
          const files = assets[dir] ?? [];
          const neutral = files.find((f) => stemOf(f) === "neutral") ?? files[0];
          return {
            id,
            name: nameOf(id),
            spriteUrl: neutral ? assetUrl(playId, `sprites/${id}`, neutral) : null,
          };
        })
        .filter((c): c is RefCandidate => Boolean(c.spriteUrl)),
    [spriteDirs, assets, playId, nameOf],
  );

  /** 对话框要交代的「基准是谁」：该主体已有的差分名与 neutral 定妆照地址（差分恒以它垫图）。 */
  const spriteDirState = useMemo((): SpriteDirState | undefined => {
    if (genTarget?.kind !== "sprite" || !genTarget.spriteId) return undefined;
    const dir = `sprites/${genTarget.spriteId}`;
    const files = assets[dir] ?? [];
    const neutral = files.find((f) => stemOf(f) === "neutral");
    return {
      variants: files.map(stemOf),
      ...(neutral ? { neutralUrl: assetUrl(playId, dir, neutral) } : {}),
    };
  }, [genTarget, assets, playId]);

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
          <h3>立绘</h3>
          <button
            className="ghost-btn"
            onClick={() => setGenTarget({ kind: "sprite", spriteId: "", initialVariant: "neutral" })}
            title="为一个主体出图：目录名与角色卡同名即绑定，没有卡也行"
          >
            <span className="btn-icon">
              <Icon name="sparkles" size={14} /> 生成新立绘
            </span>
          </button>
        </div>
        <p className="muted small">
          一个目录就是一个主体（人、机甲、猫、道具同权）：<code>assets/sprites/&lt;id&gt;/</code> 里的文件即差分。
          与角色卡同名就有名字与音色，没有卡也有名牌（下面填）。
        </p>
        <div className="row small">
          <input
            className="small-input"
            placeholder="新立绘 id（a-z、数字、下划线）"
            value={newSpriteId}
            onChange={(e) => setNewSpriteId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
          />
          <label className="btn-as-label small">
            上传
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={!newSpriteId}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && newSpriteId) upload(`sprites/${newSpriteId}`, file);
                e.target.value = "";
              }}
            />
          </label>
          <span className="muted small">文件名即差分名（如 neutral.png、smile.png）</span>
        </div>

        {orderedDirs.map((dir) => {
          const spriteId = dir.slice("sprites/".length);
          const files = assets[dir] ?? [];
          const decl = spriteDeclarationOf(assetMeta, spriteId);
          const cardName = cardNames.get(spriteId);
          // 标题写引擎真正在用的名字（卡 name → 名牌 → id）：只有图没卡也是常态，
          // 名字跟 id 不同才把 id 并排带上——脚本里引用的是 id，藏掉它会更难用。
          const label = nameOf(spriteId);
          return (
            <div key={spriteId} className="sprite-card">
              <div className="assets-section-head">
                <strong>
                  {label}
                  {label !== spriteId && <span className="muted small"> {spriteId}</span>}
                  {/* 有卡时名字本来就从卡上来，不必再说一遍；没卡才是要讲清的状态 */}
                  {!cardName && <span className="muted small"> 只有立绘</span>}
                </strong>
                <button
                  className="ghost-btn"
                  title="一次挑几个差分名，批量出图"
                  onClick={() =>
                    setGenTarget({
                      kind: "sprite",
                      spriteId,
                      ...(decl.title ? { spriteTitle: decl.title } : {}),
                      initialFraming: decl.framing ?? "full",
                      initialStature: decl.stature ?? "normal",
                      variantsBatch: true,
                    })
                  }
                >
                  <span className="btn-icon">
                    <Icon name="plus" size={13} /> 差分
                  </span>
                </button>
                <button
                  className="ghost-btn"
                  onClick={() =>
                    setGenTarget({
                      kind: "sprite",
                      spriteId,
                      ...(decl.title ? { spriteTitle: decl.title } : {}),
                      initialVariant: files.length === 0 ? "neutral" : "",
                      initialFraming: decl.framing ?? "full",
                      initialStature: decl.stature ?? "normal",
                    })
                  }
                >
                  <span className="btn-icon">
                    <Icon name="sparkles" size={13} /> 出图
                  </span>
                </button>
                <label className="btn-as-label small">
                  上传差分
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) upload(dir, file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              <div className="row small">
                <span className="muted small">名牌</span>
                <input
                  className="small-input"
                  placeholder="没有角色卡时的名字"
                  defaultValue={decl.title ?? ""}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value !== (decl.title ?? "")) declare(spriteId, { title: value || null });
                  }}
                />
                <span className="muted small">取景</span>
                <select
                  value={decl.framing ?? ""}
                  onChange={(e) =>
                    declare(spriteId, { framing: (e.target.value || null) as SpriteFraming | null })
                  }
                >
                  <option value="">未声明（全身）</option>
                  {SPRITE_FRAMINGS.map((f) => (
                    <option key={f} value={f}>
                      {SPRITE_FRAMING_LABELS[f]}
                    </option>
                  ))}
                </select>
                <span className="muted small">体量</span>
                <select
                  value={decl.stature ?? ""}
                  onChange={(e) =>
                    declare(spriteId, { stature: (e.target.value || null) as SpriteStature | null })
                  }
                >
                  <option value="">未声明（标准）</option>
                  {SPRITE_STATURES.map((s) => (
                    <option key={s} value={s}>
                      {SPRITE_STATURE_LABELS[s]}
                    </option>
                  ))}
                </select>
                <span className="muted small">对齐</span>
                <select
                  value={decl.anchor ?? ""}
                  onChange={(e) =>
                    declare(spriteId, { anchor: (e.target.value || null) as ActorAnchor | null })
                  }
                >
                  <option value="">未声明（贴底）</option>
                  {ACTOR_ANCHORS.map((a) => (
                    <option key={a} value={a}>
                      {ANCHOR_LABELS[a]}
                    </option>
                  ))}
                </select>
              </div>

              {files.length === 0 ? (
                <p className="muted small">这一目录还没有图。</p>
              ) : (
                <ul className="asset-list">
                  {files.map((name) => {
                    const variant = stemOf(name);
                    const override = spriteDeclarationOf(assetMeta, spriteId, variant).framing;
                    return (
                      <li key={name} className="asset-row">
                        <button
                          className="asset-thumb"
                          onClick={() => setZoom({ url: assetUrl(playId, dir, name), name: `${spriteId}/${name}` })}
                          title="点击看大图"
                        >
                          <img src={assetUrl(playId, dir, name)} alt={name} loading="lazy" />
                        </button>
                        <span className="asset-name" title={noteFor(dir, name) ?? variant}>
                          {variant}
                          {noteFor(dir, name) && <em className="asset-note">{noteFor(dir, name)}</em>}
                        </span>
                        <select
                          value={override ?? ""}
                          title="这条差分的取景；留空跟随上面的立绘取景"
                          onChange={(e) =>
                            declare(spriteId, {
                              variant,
                              framing: (e.target.value || null) as SpriteFraming | null,
                            })
                          }
                        >
                          <option value="">取景跟随立绘</option>
                          {SPRITE_FRAMINGS.map((f) => (
                            <option key={f} value={f}>
                              {SPRITE_FRAMING_LABELS[f]}
                            </option>
                          ))}
                        </select>
                        <button
                          className="ghost-btn icon-only small"
                          title={`重新生成「${variant}」差分`}
                          onClick={() =>
                            setGenTarget({
                              kind: "sprite",
                              spriteId,
                              ...(decl.title ? { spriteTitle: decl.title } : {}),
                              initialVariant: variant,
                              initialFraming: (override ?? decl.framing) ?? "full",
                              initialStature: decl.stature ?? "normal",
                              fixedVariant: true,
                            })
                          }
                        >
                          <Icon name="sparkles" size={13} />
                        </button>
                        <button className="link-btn" onClick={() => remove(dir, name)}>
                          删除
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </section>

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
              <div className="row small" style={{ margin: "4px 0" }}>
                {(kind === "backgrounds" || kind === "cg") && (
                  <button
                    type="button"
                    className="ghost-btn small"
                    onClick={() =>
                      setGenTarget({
                        kind: kind === "backgrounds" ? "background" : "cg",
                      })
                    }
                  >
                    <span className="btn-icon">
                      <Icon name="sparkles" size={13} /> 生成
                    </span>
                  </button>
                )}
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
              </div>
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
      {genTarget !== null && (
        <ImageGenDialog
          playId={playId}
          target={genTarget}
          refCandidates={refCandidates}
          subscribeImageResult={subscribeImageResult}
          onClose={() => setGenTarget(null)}
          onDone={reload}
          spriteDir={spriteDirState}
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
