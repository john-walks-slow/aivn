import { useCallback, useEffect, useState } from "react";
import type { CharacterCard, LibraryEntry, PlayConfig } from "@stage-ai/core";
import { api, type PlayDetail } from "../api.js";
import { Icon } from "../ui/Icon.js";
import { CharacterEditor } from "./CharacterEditor.js";
import { LibraryBrowser } from "./LibraryBrowser.js";
import { VoiceLibrary } from "../voice/VoiceLibrary.js";
import { useVoiceCatalog } from "../voice/useVoiceCatalog.js";

const PROTAGONIST_KEY = "protagonist";

/**
 * 角色：主角卡与全部角色卡。这一页全是「人」——每个角色一条，编辑器一样，
 * 只是主角卡没有立绘也没有音色（玩家不上台）。
 */
export function CharacterPane({ playId, revision }: { playId: string; revision: number }) {
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [draft, setDraft] = useState<PlayConfig | null>(null);
  const [assets, setAssets] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState<string | null>(PROTAGONIST_KEY);
  const [libraryInto, setLibraryInto] = useState<string | null>(null);
  const [voiceFor, setVoiceFor] = useState<number | null>(null);
  const voices = useVoiceCatalog();

  const reload = useCallback((): void => {
    api
      .playDetail(playId)
      .then((d) => {
        setDetail(d);
        setDraft(d.play);
      })
      .catch((e: Error) => setError(e.message));
    api.listAssets(playId).then(setAssets).catch(() => {});
  }, [playId]);
  useEffect(reload, [reload, revision]);

  const patch = (fn: (play: PlayConfig) => void): void => {
    if (!draft) return;
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
    setSaved(false);
  };

  const savePlay = (): void => {
    if (!draft) return;
    api
      .savePlay(draft)
      .then(() => {
        setSaved(true);
        reload();
      })
      .catch((e: Error) => setError(e.message));
  };

  /** 导入 / 新建之后把焦点挪到落点：从资源库导入完还停在旧卡上，等于没导入。 */
  const focus = (id: string): void => {
    setOpen(id);
    reload();
  };

  const addCharacter = (): void => {
    if (!draft) return;
    const id = `char${draft.characters.length + 1}`;
    patch((p) => p.characters.push({ id, name: "新角色", persona: "", sprites: {} }));
    setOpen(`char:${id}`);
  };

  if (!draft) return <div className="workshop-tab-pane">读取中…</div>;

  const active = open === PROTAGONIST_KEY ? PROTAGONIST_KEY : open?.replace(/^char:/, "") ?? "";
  const activeIndex = draft.characters.findIndex((c) => `char:${c.id}` === open);

  return (
    <div className="workshop-tab-pane setting-cards-pane">
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="setting-cards">
        <button
          type="button"
          className={`setting-card${open === PROTAGONIST_KEY ? " active" : ""}`}
          onClick={() => setOpen(PROTAGONIST_KEY)}
        >
          <Icon name="users" size={14} />
          <span className="setting-card-title">主角</span>
          <span className="setting-card-summary">
            {draft.protagonist?.name || "（玩家，上台的是别人）"}
          </span>
        </button>
        {draft.characters.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`setting-card${open === `char:${c.id}` ? " active" : ""}`}
            onClick={() => setOpen(`char:${c.id}`)}
          >
            <Icon name="users" size={14} />
            <span className="setting-card-title">{c.name || c.id}</span>
            <span className="setting-card-summary">{c.persona || "（还没写性格）"}</span>
          </button>
        ))}
        {/* 加人也是这个网格里的一件事：入口摆在人旁边，而不是滚到底部那个角落 */}
        <button
          type="button"
          className="setting-card add"
          onClick={() => setLibraryInto("")}
          title="从应用级资源库挑角色卡与立绘复制进本剧目（按条目的 id 建角色，同 id 则覆盖）"
        >
          <Icon name="download" size={14} />
          <span className="setting-card-title">从资源库导入</span>
          <span className="setting-card-summary">复制现成的角色卡与立绘</span>
        </button>
        <button type="button" className="setting-card add" onClick={addCharacter}>
          <Icon name="plus" size={14} />
          <span className="setting-card-title">新建角色</span>
          <span className="setting-card-summary">从空白开始写</span>
        </button>
      </div>

      {active === PROTAGONIST_KEY ? (
        <section className="panel">
          <h3>主角卡（玩家）</h3>
          <p className="muted small">玩家自己。不上台，也没有立绘和音色。</p>
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
            <div className="row small">
              <button className="ghost-btn" onClick={() => setLibraryInto(PROTAGONIST_KEY)}>
                <span className="btn-icon">
                  <Icon name="download" size={13} /> 从资源库导入主角卡
                </span>
              </button>
            </div>
            <textarea
              rows={4}
              placeholder="persona（性格与说话风格——输入润色的口吻依据）"
              value={draft.protagonist?.persona ?? ""}
              onChange={(e) =>
                patch((p) => (p.protagonist = { name: p.protagonist?.name ?? "", persona: e.target.value }))
              }
            />
          </div>
        </section>
      ) : activeIndex >= 0 ? (
        <section className="panel">
          <h3>角色卡</h3>
          <CharacterEditor
            playId={playId}
            char={draft.characters[activeIndex] as CharacterCard}
            files={assets[`sprites/${draft.characters[activeIndex]!.id}`] ?? []}
            voices={voices}
            onPickVoice={() => setVoiceFor(activeIndex)}
            onBrowseLibrary={() => setLibraryInto(draft.characters[activeIndex]!.id)}
            onUploadSprite={(file) =>
              api
                .uploadAsset(playId, `sprites/${draft.characters[activeIndex]!.id}`, file.name, file)
                .then(reload)
                .catch((e: Error) => setError(e.message))
            }
            onChange={(fn) => patch((p) => fn(p.characters[activeIndex]!))}
            onRemove={() => {
              patch((p) => p.characters.splice(activeIndex, 1));
              setOpen(PROTAGONIST_KEY);
            }}
          />
        </section>
      ) : null}

      {detail && (active === PROTAGONIST_KEY || activeIndex >= 0) && (
        <p className="row">
          <button className="primary" onClick={savePlay}>
            保存
          </button>
          {saved && <span className="muted small">已保存</span>}
        </p>
      )}
      {libraryInto !== null && detail && (
        <LibraryBrowser
          playId={playId}
          imported={(kind, id) =>
            kind === "characters"
              ? libraryInto === PROTAGONIST_KEY
                ? Boolean(detail.play.protagonist?.name || detail.play.protagonist?.persona)
                : detail.play.characters.some((c) => c.id === id)
              : false
          }
          onClose={() => setLibraryInto(null)}
          onImported={(r) => focus(r.protagonist ? PROTAGONIST_KEY : `char:${r.characters[0] ?? libraryInto}`)}
          {...(libraryInto === PROTAGONIST_KEY
            ? {
                target: "protagonist" as const,
                title: "从资源库导入主角卡",
                filter: (e: LibraryEntry) => Boolean(e.meta.character?.protagonist),
              }
            : {})}
        />
      )}
      {voiceFor !== null && draft && (
        <VoiceLibrary
          playId={playId}
          voices={voices}
          onClose={() => setVoiceFor(null)}
          onPick={(entry) => {
            patch((p) => (p.characters[voiceFor]!.voiceId = entry.id));
            setVoiceFor(null);
          }}
        />
      )}
    </div>
  );
}
