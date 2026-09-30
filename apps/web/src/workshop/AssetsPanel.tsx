import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetKind, AssetMeta, CharacterCard, LibraryEntry, PlayConfig } from "@stage-ai/core";
import { languageLabel, LANGUAGE_LABELS } from "@stage-ai/core";
import { api, assetUrl, type PlayDetail } from "../api.js";
import { Icon } from "../ui/Icon.js";
import { ImageLightbox } from "../ui/ImageLightbox.js";
import { LibraryBrowser } from "./LibraryBrowser.js";
import { VoiceLibrary } from "../voice/VoiceLibrary.js";
import { useVoiceCatalog, type VoiceCatalogState } from "../voice/useVoiceCatalog.js";

const KINDS = ["backgrounds", "cg", "sfx", "bgm"] as const;

/** 文件名去掉扩展名：素材表与文件名对不上时，仍能按 stem 找到描述。 */
const stemOf = (name: string): string => name.replace(/\.\w+$/, "");

/** 素材库与剧目配置：原素材页整体搬进工坊（工坊 = 搭台的唯一去处）。 */
export function AssetsPanel({ playId }: { playId: string }) {
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [assets, setAssets] = useState<Record<string, string[]>>({});
  const [assetMeta, setAssetMeta] = useState<Record<string, AssetMeta>>({});
  const [draft, setDraft] = useState<PlayConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** 世界观前提独立于 play.json（写 memory/always/premise.md），所以有自己的草稿态。 */
  const [premise, setPremise] = useState("");
  const [premiseDraft, setPremiseDraft] = useState("");
  const [zoom, setZoom] = useState<{ url: string; name: string } | null>(null);
  /** 资源库导入的落点：null = 面板关闭，"" = 素材（无落点），"protagonist" = 主角卡，角色 id = 角色列表。 */
  const [libraryInto, setLibraryInto] = useState<string | null>(null);
  const voices = useVoiceCatalog();
  /** 正在开音色库的角色下标（null = 面板关闭）。 */
  const [libraryChar, setLibraryChar] = useState<number | null>(null);

  const reload = useCallback((): void => {
    api
      .playDetail(playId)
      .then((d) => {
        setDetail(d);
        setDraft(d.play);
        setPremise(d.premise);
        setPremiseDraft(d.premise);
      })
      .catch((e: Error) => setError(e.message));
    api.listAssets(playId).then(setAssets).catch(() => {});
    api.assetMeta(playId).then(setAssetMeta).catch(() => {});
  }, [playId]);
  useEffect(reload, [reload]);

  const patch = (fn: (play: PlayConfig) => void): void => {
    if (!draft) return;
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
    setSaved(false);
  };

  const save = (): void => {
    if (!draft) return;
    // premise 落在 memory/always/premise.md，不随 play.json 走，但它就在这块面板里——
    // 保存配置必须连它一起提交，否则 reload 会把手写的前提冲回服务端旧值
    const work: Promise<unknown>[] = [api.savePlay(draft)];
    if (premiseDraft !== premise) work.push(api.savePremise(playId, premiseDraft));
    Promise.all(work)
      .then(() => {
        setSaved(true);
        reload();
      })
      .catch((e: Error) => setError(e.message));
  };

  /** 只改前提时的快捷口：与「保存配置」提交的是同一份内容。 */
  const savePremiseOnly = (): void => {
    api
      .savePremise(playId, premiseDraft)
      .then(() => {
        setPremise(premiseDraft);
        setSaved(true);
      })
      .catch((e: Error) => setError(e.message));
  };

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
    const key = dir.startsWith("sprites/") ? `${dir.slice("sprites/".length)}/${stemOf(name)}` : stemOf(name);
    return assetMeta[key]?.description ?? null;
  };

  return (
    <div className="workshop-tab-pane assets-pane">
      {readiness && (
        <div className="assets-pane-head">
          <span className={`badge ${readiness.ready ? "ok" : "warn"}`}>
            {readiness.ready ? "能开演" : "还不能开演"}
          </span>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {draft && (
        <section className="panel">
          <h3>剧目配置（play.json）</h3>
          <label className="field">
            <span>标题</span>
            <input value={draft.title} onChange={(e) => patch((p) => (p.title = e.target.value))} />
          </label>
          <label className="field">
            <span>
              premise（世界与人物设定）
              <button
                className="ghost-btn small"
                disabled={premise === premiseDraft}
                onClick={savePremiseOnly}
              >
                只存前提
              </button>
            </span>
            <textarea
              rows={4}
              placeholder="写进 memory/always/premise.md —— 剧作家每一拍都读它，空着则开不了演"
              value={premiseDraft}
              onChange={(e) => setPremiseDraft(e.target.value)}
            />
          </label>
          <label className="field">
            <span>opening（开局指令）</span>
            <textarea
              rows={2}
              value={draft.opening}
              onChange={(e) => patch((p) => (p.opening = e.target.value))}
            />
          </label>
          <label className="field">
            <span>语音语言（say 台词翻译后再送 TTS）</span>
            <select
              value={draft.voiceLanguage ?? ""}
              onChange={(e) => patch((p) => (p.voiceLanguage = e.target.value || undefined))}
            >
              <option value="">跟随剧本语言（不翻译）</option>
              {Object.keys(LANGUAGE_LABELS)
                .sort()
                .map((code) => (
                  <option key={code} value={code}>
                    {languageLabel(code)}（{code}）
                  </option>
                ))}
            </select>
            <p className="muted small">翻译由 LLM 完成，任何小语种都能用——前提是所选音色支持该语言。</p>
          </label>

          <h3>主角卡（玩家）</h3>
          <div className="char-card">
            <div className="row">
              <input
                placeholder="主角名（如：你 / 转学生）"
                value={draft.protagonist?.name ?? ""}
                onChange={(e) =>
                  patch((p) => (p.protagonist = { name: e.target.value, persona: p.protagonist?.persona ?? "" }))
                }
              />
            </div>
            <textarea
              rows={2}
              placeholder="persona（性格与说话风格——输入润色的口吻依据）"
              value={draft.protagonist?.persona ?? ""}
              onChange={(e) =>
                patch((p) => (p.protagonist = { name: p.protagonist?.name ?? "", persona: e.target.value }))
              }
            />
            <p className="muted small">
              留空则「<Icon name="sparkles" size={12} /> 润色」走通用模式（只修顺语句，不改口吻）。
            </p>
            <div className="row small">
              <button className="ghost-btn" onClick={() => setLibraryInto("protagonist")} title="从资源库导入一张主角卡">
                <span className="btn-icon">
                  <Icon name="download" size={13} /> 从资源库导入
                </span>
              </button>
            </div>
          </div>

          <h3>角色卡</h3>
          {draft.characters.map((char, i) => (
            <CharacterEditor
              key={char.id}
              playId={playId}
              char={char}
              files={assets[`sprites/${char.id}`] ?? []}
              voices={voices}
              onPickVoice={() => setLibraryChar(i)}
              onBrowseLibrary={() => setLibraryInto(char.id)}
              onUploadSprite={(file) => upload(`sprites/${char.id}`, file)}
              onChange={(fn) => patch((p) => fn(p.characters[i]!))}
              onRemove={() => patch((p) => p.characters.splice(i, 1))}
            />
          ))}
          <button
            className="ghost-btn"
            onClick={() =>
              patch((p) => {
                const id = `char${p.characters.length + 1}`;
                p.characters.push({ id, name: "新角色", persona: "", sprites: {} });
              })
            }
          >
            <span className="btn-icon">
              <Icon name="plus" /> 添加角色
            </span>
          </button>

          <p className="row">
            <button className="primary" onClick={save}>
              保存配置
            </button>
            {saved && <span className="muted small">已保存</span>}
          </p>
        </section>
      )}

      <section className="panel">
        <div className="assets-section-head">
          <h3>素材</h3>
          <button className="ghost-btn" onClick={() => setLibraryInto("")} title="从应用级资源库挑素材复制进本剧目">
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
          imported={(kind, id) =>
            kind === "characters"
              ? libraryInto === "protagonist"
                ? Boolean(detail?.play.protagonist?.name || detail?.play.protagonist?.persona)
                : (detail?.play.characters ?? []).some((c) => c.id === id)
              : isImported(kind, id)
          }
          onClose={() => setLibraryInto(null)}
          onImported={reload}
          {...(libraryInto === "protagonist"
            ? {
                target: "protagonist" as const,
                title: "从资源库导入主角卡",
                filter: (e: LibraryEntry) => Boolean(e.meta.character?.protagonist),
              }
            : {})}
        />
      )}
      {libraryChar !== null && draft && (
        <VoiceLibrary
          playId={playId}
          voices={voices}
          onClose={() => setLibraryChar(null)}
          onPick={(entry) => {
            patch((p) => (p.characters[libraryChar]!.voiceId = entry.id));
            setLibraryChar(null);
          }}
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

/** 差分映射编辑行（本地稳定 id，避免以可变 expression 作 key 导致每击键重挂载失焦）。 */
interface SpriteRow {
  id: number;
  expression: string;
  file: string;
}

function CharacterEditor({
  playId,
  char,
  files,
  voices,
  onPickVoice,
  onBrowseLibrary,
  onUploadSprite,
  onChange,
  onRemove,
}: {
  playId: string;
  char: CharacterCard;
  files: string[];
  voices: VoiceCatalogState;
  onPickVoice: () => void;
  onBrowseLibrary: () => void;
  onUploadSprite: (file: File) => void;
  onChange: (fn: (char: CharacterCard) => void) => void;
  onRemove: () => void;
}) {
  const nextId = useRef(0);
  const [previewing, setPreviewing] = useState(false);
  // 行状态挂载时从角色卡初始化；编辑期以本地行为准，blur/离散操作时提交回角色卡
  const [rows, setRows] = useState<SpriteRow[]>(() =>
    Object.entries(char.sprites ?? {}).map(([expression, file]) => ({
      id: nextId.current++,
      expression,
      file,
    })),
  );

  /** 音色试听：服务端合成固定样本 → 播放（Fish 公共库音色，目录内目录外都能试）。 */
  const previewVoice = (): void => {
    if (!char.voiceId || previewing) return;
    setPreviewing(true);
    api
      .ttsPreview(playId, char.voiceId)
      .then(({ url }) => {
        void new Audio(url).play().catch(() => {});
      })
      .catch((e: Error) => window.alert(`试听失败：${e.message}`))
      .finally(() => setPreviewing(false));
  };

  // 目录外的 voiceId（demo 剧目的萝莉萌妹等）按 id 单条解析出名字，不装作"未设置"
  const { resolve: resolveVoice } = voices;
  useEffect(() => {
    resolveVoice(char.voiceId);
  }, [resolveVoice, char.voiceId]);

  const commit = (source: SpriteRow[]): void => {
    onChange((c) => {
      c.sprites = Object.fromEntries(
        source.filter((r) => r.expression.trim() !== "").map((r) => [r.expression.trim(), r.file]),
      );
    });
  };

  const setFile = (id: number, file: string): void => {
    const next = rows.map((r) => (r.id === id ? { ...r, file } : r));
    setRows(next);
    commit(next);
  };

  const dropRow = (id: number): void => {
    const next = rows.filter((r) => r.id !== id);
    setRows(next);
    commit(next);
  };

  const addRow = (): void => {
    setRows((prev) => [...prev, { id: nextId.current++, expression: "", file: files[0] ?? "" }]);
  };

  return (
    <div className="char-card">
      <div className="row">
        <input value={char.name} onChange={(e) => onChange((c) => (c.name = e.target.value))} />
        <button className="link-btn" onClick={onRemove}>
          移除角色
        </button>
      </div>
      <textarea
        rows={2}
        placeholder="persona（性格与背景）"
        value={char.persona}
        onChange={(e) => onChange((c) => (c.persona = e.target.value))}
      />
      <div className="voice-row">
        <button className="ghost-btn voice-picker" onClick={onPickVoice}>
          音色：{voices.nameOf(char.voiceId)}
        </button>
        {char.voiceId && (
          <button className="ghost-btn" onClick={() => onChange((c) => (c.voiceId = undefined))}>
            清除
          </button>
        )}
        <button className="ghost-btn" disabled={!char.voiceId || previewing} onClick={previewVoice}>
          {previewing ? "合成中…" : "试听"}
        </button>
      </div>
      <p className="muted small">立绘差分映射（expression → 文件）——差分文件传在这里，会落到 sprites/{char.id}/</p>
      {rows.map((row) => (
        <div key={row.id} className="row small">
          <input
            className="small-input"
            value={row.expression}
            autoFocus={row.expression === ""}
            onChange={(e) =>
              setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, expression: e.target.value } : r)))
            }
            onBlur={() => commit(rows)}
          />
          <select value={row.file} onChange={(e) => setFile(row.id, e.target.value)}>
            {files.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <button className="link-btn" onClick={() => dropRow(row.id)}>
            删
          </button>
        </div>
      ))}
      <div className="row small">
        <label className="btn-as-label small">
          上传立绘
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUploadSprite(file);
              e.target.value = "";
            }}
          />
        </label>
        <button
          className="ghost-btn"
          onClick={onBrowseLibrary}
          title={`从资源库导入一个角色的角色卡与立绘（按条目的 id 新建或覆盖同 id 的角色，不是填这张卡）`}
        >
          <span className="btn-icon">
            <Icon name="download" size={13} /> 从资源库导入
          </span>
        </button>
        <button className="ghost-btn" onClick={addRow}>
          <span className="btn-icon">
            <Icon name="plus" size={13} /> 添加映射
          </span>
        </button>
      </div>
    </div>
  );
}
